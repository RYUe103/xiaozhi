(function (globalScope) {
  if (typeof Object.hasOwn !== 'function') {
    Object.defineProperty(Object, 'hasOwn', {
      configurable: true,
      writable: true,
      value: function (object, property) {
        return Object.prototype.hasOwnProperty.call(Object(object), property);
      },
    });
  }

  if (typeof String.prototype.replaceAll !== 'function') {
    Object.defineProperty(String.prototype, 'replaceAll', {
      configurable: true,
      writable: true,
      value: function (searchValue, replaceValue) {
        var input = String(this);

        if (searchValue != null) {
          var isRegExp = Object.prototype.toString.call(searchValue) === '[object RegExp]';
          if (isRegExp && !searchValue.global) {
            throw new TypeError('String.prototype.replaceAll called with a non-global RegExp');
          }

          var replacer = searchValue[Symbol.replace];
          if (typeof replacer === 'function') {
            return replacer.call(searchValue, input, replaceValue);
          }
        }

        var search = String(searchValue);
        var replacementIsFunction = typeof replaceValue === 'function';
        var replacement = replacementIsFunction ? null : String(replaceValue);
        var step = Math.max(1, search.length);
        var position = 0;
        var matchPosition = input.indexOf(search, position);
        var result = '';

        while (matchPosition !== -1) {
          result += input.slice(position, matchPosition);
          if (replacementIsFunction) {
            result += String(replaceValue(search, matchPosition, input));
          } else {
            result += replacement.replace(/\$([$&`'])/g, function (match, token) {
              if (token === '$') {
                return '$';
              }
              if (token === '&') {
                return search;
              }
              if (token === '`') {
                return input.slice(0, matchPosition);
              }
              return input.slice(matchPosition + search.length);
            });
          }
          position = matchPosition + search.length;
          matchPosition = input.indexOf(search, matchPosition + step);
        }

        return result + input.slice(position);
      },
    });
  }

  function at(index) {
    var object = Object(this);
    var length = Number(object.length) || 0;
    var relativeIndex = Number(index) || 0;
    relativeIndex = relativeIndex < 0 ? Math.ceil(relativeIndex) : Math.floor(relativeIndex);
    var actualIndex = relativeIndex >= 0 ? relativeIndex : length + relativeIndex;
    return actualIndex < 0 || actualIndex >= length ? undefined : object[actualIndex];
  }

  var atPrototypes = [Array.prototype, String.prototype];
  [
    'Int8Array',
    'Uint8Array',
    'Uint8ClampedArray',
    'Int16Array',
    'Uint16Array',
    'Int32Array',
    'Uint32Array',
    'Float32Array',
    'Float64Array',
    'BigInt64Array',
    'BigUint64Array',
  ].forEach(function (constructorName) {
    if (typeof globalScope[constructorName] === 'function') {
      atPrototypes.push(globalScope[constructorName].prototype);
    }
  });
  atPrototypes.forEach(function (prototype) {
    if (typeof prototype.at !== 'function') {
      Object.defineProperty(prototype, 'at', {
        configurable: true,
        writable: true,
        value: at,
      });
    }
  });

  if (typeof globalScope.AggregateError !== 'function') {
    function AggregateError(errors, message) {
      var error = new Error(message);
      Object.setPrototypeOf(error, AggregateError.prototype);
      Object.defineProperty(error, 'errors', {
        configurable: true,
        writable: true,
        value: Array.from(errors),
      });
      return error;
    }
    AggregateError.prototype = Object.create(Error.prototype, {
      constructor: { configurable: true, writable: true, value: AggregateError },
      name: { configurable: true, writable: true, value: 'AggregateError' },
    });
    globalScope.AggregateError = AggregateError;
  }

  if (typeof URL === 'function' && typeof URL.canParse !== 'function') {
    URL.canParse = function (url, base) {
      try {
        if (arguments.length > 1) {
          new URL(url, base);
        } else {
          new URL(url);
        }
        return true;
      } catch (error) {
        return false;
      }
    };
  }

  if (typeof globalScope.structuredClone !== 'function') {
    globalScope.structuredClone = function (value) {
      var seen = new Map();

      function clone(input) {
        if (input === null || typeof input !== 'object') {
          if (typeof input === 'function' || typeof input === 'symbol') {
            throw new TypeError('Unable to clone ' + typeof input);
          }
          return input;
        }
        if (seen.has(input)) {
          return seen.get(input);
        }

        var output;
        if (input instanceof Date) {
          return new Date(input.getTime());
        }
        if (input instanceof RegExp) {
          output = new RegExp(input.source, input.flags);
          output.lastIndex = input.lastIndex;
          return output;
        }
        if (input instanceof Map) {
          output = new Map();
          seen.set(input, output);
          input.forEach(function (entry, key) {
            output.set(clone(key), clone(entry));
          });
          return output;
        }
        if (input instanceof Set) {
          output = new Set();
          seen.set(input, output);
          input.forEach(function (entry) {
            output.add(clone(entry));
          });
          return output;
        }
        if (input instanceof ArrayBuffer) {
          return input.slice(0);
        }
        if (ArrayBuffer.isView(input)) {
          var clonedBuffer = clone(input.buffer);
          if (input instanceof DataView) {
            return new DataView(clonedBuffer, input.byteOffset, input.byteLength);
          }
          return new input.constructor(clonedBuffer, input.byteOffset, input.length);
        }
        if (typeof Blob === 'function' && input instanceof Blob) {
          return input.slice(0, input.size, input.type);
        }
        if (input instanceof Error) {
          output = new input.constructor(input.message);
          output.name = input.name;
          output.stack = input.stack;
          seen.set(input, output);
        } else {
          output = Array.isArray(input) ? [] : {};
          seen.set(input, output);
        }

        Object.keys(input).forEach(function (key) {
          output[key] = clone(input[key]);
        });
        return output;
      }

      return clone(value);
    };
  }
})(typeof globalThis === 'object' ? globalThis : window);
