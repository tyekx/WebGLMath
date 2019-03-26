/* exported UniformReflection */
/**
 * @file WebGLMath UniformReflection object
 * @copyright Laszlo Szecsi 2019
 */
"use strict";

function StructProxy() {
  // empty "class" for type-checking
}

function ArrayProxy() {
  // double $ is the angular-way of saying private
  this.$$storage = {};
  this.$$size = 0;

  // needed because of the GLSL way of handling uniforms, we must deduce the size of an ArrayProxy manually
  this.insert = (newIndex) => {
    if(!this.$$storage.hasOwnProperty(newIndex)) {
      if(this.$$size <= newIndex) {
        this.$$size = newIndex+1;
      }
      this.$$storage[newIndex] = {};
    }
  }

  this.getSize = () => {
    return this.$$size;
  }

  this.at = (i) => {
    if(i >= 0 && i < this.$$size) {
      return this.$$storage[i];
    }
    // overindexed
    return null;
  };

  this.getKeys = () => {
    return Object.keys(this.$$storage);
  };
}

/**
 * @class UniformReflection
 * @classdesc A collection of static factory methods that return WebGLMath objects reflecting WebGL uniforms.
 * The purpose is to offer a way of creating objects by ESSL type name and array size.
 * It also offers the static addProperties method to automate populating objects with reflected uniforms.
 */
const UniformReflection = {
  addProperties: function(gl, glProgram, target) {
    const nUniforms = gl.getProgramParameter(glProgram, gl.ACTIVE_UNIFORMS);
    for(let i = 0; i < nUniforms; ++i) {
      const glUniform = gl.getActiveUniform(glProgram, i);

      const reflectionCtor = () => { return UniformReflection.makeVar(gl, glUniform.type, glUniform.size || 1) };
      // this handles the struct depth, we always reset it to target after every property
      var depthIter = target;
      // split by each struct entity
      const nameParts = glUniform.name.split('.');
      // foreach namepart we try to build the same layout in the "target" variable
      for(let j = 0; j < nameParts.length; ++j) {
        // try checking if its an array
        const bracketSplit = nameParts[j].split('[');
        // get the actual property name
        const propertyName = bracketSplit[0];
        // get the index if there is one
        let index = null;
        if(bracketSplit.length > 1) {
          index = Number(bracketSplit[1].replace("]", ""));
        }
        // check if we have a proxy already at the current depth
        if(!depthIter.hasOwnProperty(propertyName)) {
          // if we dont have a property with the name, we create it after a few checks

          // are we at the leaf item? If so we have to insert the proper GLSL data structure
          if(j == nameParts.length - 1) {
            // here we do not need to handle the array case, because its handled by the UniformReflectionFactories.js
            // if its a vec4 array for example, then it'll create the corresponding type there (Vec4Array)
            Object.defineProperty(depthIter, propertyName, { value: reflectionCtor() });
          } else {
            // if its not a leaf item however, we will have to continue building our data structure
            if(index !== null) {
              // insert an array proxy, which has an indexing operator and a size
              Object.defineProperty(depthIter, propertyName, { value: new ArrayProxy() });
            } else {
              // insert an empty object with a comparable type (if instanceof StructProxy)
              Object.defineProperty(depthIter, propertyName, { value: new StructProxy() });
            }
          }
        }
        // progressing to the next depth, if its an array we need to progress using the 0th index
        if(depthIter[propertyName] instanceof ArrayProxy) {
          depthIter[propertyName].insert(index);
          depthIter = depthIter[propertyName].at(index);
        } else depthIter = depthIter[propertyName];
      }

    }
    
    return UniformReflection.makeProxy(target);
  },
  $$recursiveCommit: function(depthIter, nameParts, ni, glUniform, gl, glProgram, constTextureCount) {
    const bracketSplit = nameParts[ni].split('[');
    // get the actual property name
    const propertyName = bracketSplit[0];

    if(depthIter.hasOwnProperty(propertyName)) {
      // check if its an arrayproxy
      if(depthIter[propertyName] instanceof ArrayProxy) {
        const keys = depthIter[propertyName].getKeys();
        const index = Number(bracketSplit[1].replace("]",""));
        // if so, we need to iterate through all
        const io = keys.indexOf(index);
        if(io != -1) {
          UniformReflection.$$recursiveCommit(depthIter[propertyName].at(io), nameParts, ni + 1, glUniform, gl, glProgram, constTextureCount);
        } // else return
      }

      if(ni == nameParts.length - 1) {
        // we wont need to index at the leaf, since it'll be saved as Vec4Array with a size inside
        const location = gl.getUniformLocation(glProgram, glUniform.name);
        depthIter[propertyName].commit(gl, location, constTextureCount);
      } else {
        UniformReflection.$$recursiveCommit(depthIter[propertyName], nameParts, ni + 1, glUniform, gl, glProgram, constTextureCount);
      }
    } // else return
  },
  commitProperties: function(gl, glProgram, target) {
    const nUniforms = gl.getProgramParameter(glProgram, gl.ACTIVE_UNIFORMS);
    let textureUnitCount = 0;
    for(let i = 0; i < nUniforms; ++i) {
      const glUniform = gl.getActiveUniform(glProgram, i);
      
      if(glUniform.type === gl.SAMPLER_2D || glUniform.type === gl.SAMPLER_CUBE){ 
        textureUnitCount += glUniform.size || 1; 
      }

      const nameParts = glUniform.name.split('.');
      UniformReflection.$$recursiveCommit(target, nameParts, 0, glUniform, gl, glProgram, textureUnitCount);
    }
  },
  /**
   * @method makeProxy
   * @memberof UniformReflection
   * @static 
   * @description Returns an object that forwards property accesses to a target, and prints a warning message if the target does not have the proerty, instead of causing an error.
   * @param {Object} target - The object whose propery accesses are to be guarded.
   * @param {String} [type="uniform"] - Printed as part of the warning message.
   */  
  makeProxy : function(target, type){
    type = type || "uniform";
    return new Proxy(target, { 
      get : function(target, name){ 
        if(!(name in target)){ 
          console.error("WARNING: Ignoring attempt to access property '" + 
            name + "'. Is '" + name + "' an unused " + type + "?" ); 
          return UniformReflection.dummy; 
        } 
        return target[name]; 
      }, 
    });  
  },  
  /**
   * @property dummy
   * @memberof UniformReflection
   * @static 
   * @description Absorbs all function calls and property accesses without effect. 
   * @type Proxy
   */  
  // absorbs all function calls and property accesses without effect
  dummy : new Proxy(() => false, { 
    get: function(){ 
      return UniformReflection.dummy; 
    }, 
    apply: function(){ 
      return UniformReflection.dummy; 
    }, 
  }),
  /**
   * @method makeVar
   * @memberof UniformReflection
   * @static 
   * @description Returns a new reflection variable based on a numberical WebGL type ID.
   * @param {WebGLRenderingContext} gl - The rendering context.
   * @param {Number} type - The numeric type of the uniform, i.e. a value of a type identifier property in the rendering context.
   * @param {Number} arraySize - The number of elements in the uniform, if it is an array. Otherwise, it must be 1.
   * @return {Vec1 | Vec1Array | Vec2 | Vec2Array | Vec3 | Vec3Array | Vec4 | Vec4Array | Mat4 | Mat4Array | Sampler2D | Sampler2DArray | SamplerCube | SamplerCubeArray} The new reflection object.
   */  
  makeVar : function(gl, type, arraySize, samplerIndex) {
    switch(type) {
      case gl.FLOAT        : return this.float(arraySize);
      case gl.FLOAT_VEC2   : return this.vec2(arraySize);
      case gl.FLOAT_VEC3   : return this.vec3(arraySize);
      case gl.FLOAT_VEC4   : return this.vec4(arraySize);
      case gl.FLOAT_MAT4   : return this.mat4(arraySize);
      case gl.SAMPLER_2D   : return this.sampler2D(arraySize, samplerIndex);
      case gl.SAMPLER_CUBE : return this.samplerCube(arraySize, samplerIndex);
      case gl.SAMPLER_3D   : return this.sampler3D(arraySize, samplerIndex);            
    }
  },
  /**
   * @method float
   * @memberof UniformReflection
   * @static 
   * @description Returns a new {@link Vec1} or {@link Vec1Array} with appropriate size.
   * @param {arraySize} - The number of elements in the uniform, if it is an array. For a single float, it must be 1.
   * @return {Vec1 | Vec1Array} The new reflection object.
   */
  float : function(arraySize){ if(arraySize === 1) { return new Vec1(); } else { return new Vec1Array   (arraySize); } },
  /**
   * @method vec2
   * @memberof UniformReflection
   * @static 
   * @description Returns a new {@link Vec2} or {@link Vec2Array} with appropriate size.
   * @param {arraySize} - The number of elements in the uniform, if it is an array. For a single vec2, it must be 1.
   * @return {Vec2 | Vec2Array} The new reflection object.
   */
  vec2  : function(arraySize){ if(arraySize === 1) { return new Vec2(); } else { return new Vec2Array   (arraySize); } },
  /**
   * @method vec3
   * @memberof UniformReflection
   * @static 
   * @description Returns a new {@link Vec3} or {@link Vec3Array} with appropriate size.
   * @param {arraySize} - The number of elements in the uniform, if it is an array. For a single vec3, it must be 1.
   * @return {Vec3 | Vec3Array} The new reflection object.
   */
  vec3  : function(arraySize){ if(arraySize === 1) { return new Vec3(); } else { return new Vec3Array   (arraySize); } },
  /**
   * @method vec4
   * @memberof UniformReflection
   * @static 
   * @description Returns a new {@link Vec4} or {@link Vec4Array} with appropriate size.
   * @param {arraySize} - The number of elements in the uniform, if it is an array. For a single vec4, it must be 1.
   * @return {Vec4 | Vec4Array} The new reflection object.
   */
  vec4  : function(arraySize){ if(arraySize === 1) { return new Vec4(); } else { return new Vec4Array   (arraySize); } },
  /**
   * @method mat4
   * @memberof UniformReflection
   * @static 
   * @description Returns a new {@link Mat4} or {@link Mat4Array} with appropriate size.
   * @param {arraySize} - The number of elements in the uniform, if it is an array. For a single mat4, it must be 1.
   * @return {Mat4 | Mat4Array} The new reflection object.
   */
  mat4  : function(arraySize){ if(arraySize === 1) { return new Mat4(); } else { return new Mat4Array   (arraySize); } },
  /**
   * @method mat4
   * @memberof UniformReflection
   * @static 
   * @description Returns a new {@link Sampler2D} object.
   * @param {arraySize} - Ignored. There are no Sampler2D arrays in ESSL.
   * @return {Mat4 | Mat4Array} The new reflection object.
   */  
  sampler2D :      function(arraySize, samplerIndex){ if(arraySize === 1) { return new Sampler2D(samplerIndex); } else { return new Sampler2DArray(arraySize, samplerIndex);}},
  samplerCube :    function(arraySize, samplerIndex){ if(arraySize === 1) { return new SamplerCube(samplerIndex); } else { return new SamplerCubeArray(arraySize, samplerIndex);}},
  sampler3D :      function(arraySize, samplerIndex){ if(arraySize === 1) { return new Sampler3D(samplerIndex); } else { return new Sampler3DArray(arraySize, samplerIndex);}},  
};
