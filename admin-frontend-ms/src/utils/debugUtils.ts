/**
 * Utility functions for debugging API responses
 */

/**
 * Extracts token from various possible locations in an API response
 */
export const extractToken = (response: any): { token: string | null, source: string } => {
  if (!response) {
    return { token: null, source: 'response is null or undefined' };
  }
  
  // Check direct properties
  if (response.token) {
    return { token: response.token, source: 'response.token' };
  }
  
  if (response.accessToken) {
    return { token: response.accessToken, source: 'response.accessToken' };
  }
  
  if (response.access_token) {
    return { token: response.access_token, source: 'response.access_token' };
  }
  
  if (response.jwt) {
    return { token: response.jwt, source: 'response.jwt' };
  }
  
  // Check nested data property
  if (response.data) {
    if (response.data.token) {
      return { token: response.data.token, source: 'response.data.token' };
    }
    
    if (response.data.accessToken) {
      return { token: response.data.accessToken, source: 'response.data.accessToken' };
    }
    
    if (response.data.access_token) {
      return { token: response.data.access_token, source: 'response.data.access_token' };
    }
    
    if (response.data.jwt) {
      return { token: response.data.jwt, source: 'response.data.jwt' };
    }
  }
  
  // Check for success property with token
  if (response.success && response.success.token) {
    return { token: response.success.token, source: 'response.success.token' };
  }
  
  return { token: null, source: 'no token found in response' };
};

/**
 * Logs all properties of an object (for debugging)
 */
export const logAllProperties = (obj: any, prefix = ''): void => {
  if (!obj) {
    console.log(`${prefix} is null or undefined`);
    return;
  }
  
  if (typeof obj !== 'object') {
    console.log(`${prefix} is not an object, it's a ${typeof obj}: ${obj}`);
    return;
  }
  
  console.log(`Properties of ${prefix || 'object'}:`);
  
  // Log direct properties
  Object.keys(obj).forEach(key => {
    const value = obj[key];
    if (value === null) {
      console.log(`${prefix}.${key} = null`);
    } else if (value === undefined) {
      console.log(`${prefix}.${key} = undefined`);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      console.log(`${prefix}.${key} = [Object]`);
    } else if (Array.isArray(value)) {
      console.log(`${prefix}.${key} = Array(${value.length})`);
    } else if (typeof value === 'function') {
      console.log(`${prefix}.${key} = [Function]`);
    } else {
      console.log(`${prefix}.${key} = ${value}`);
    }
  });
};
