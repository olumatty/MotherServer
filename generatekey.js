// Import the built-in 'crypto' module
const crypto = require('crypto');

// Generate a 64-byte (512-bit) random key and convert it to a hexadecimal string
const secretKey = crypto.randomBytes(64).toString('hex');

// Output the secret key
console.log('Generated Secret Key:', secretKey);
