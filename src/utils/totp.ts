import { TOTP, Secret } from 'otpauth';

// Convert hex string to Uint8Array
function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Convert base32 string to Uint8Array
function base32ToUint8Array(base32: string): Uint8Array {
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleanBase32 = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bits = cleanBase32.split('').map(c => base32Chars.indexOf(c).toString(2).padStart(5, '0')).join('');
  const bytes = new Uint8Array(bits.length / 8);
  for (let i = 0; i < bits.length; i += 8) {
    bytes[i / 8] = parseInt(bits.substring(i, i + 8), 2);
  }
  return bytes;
}

export const generateTOTP = (secret: string): string => {
  try {
    // Remove hyphens and spaces from secret
    const cleanSecret = secret.replace(/[-\s]/g, '');
    
    console.log('Generating TOTP with cleaned secret:', cleanSecret);
    console.log('Secret length:', cleanSecret.length);
    
    // Check if secret contains invalid base32 characters (8, 9, 0, 1)
    const hasInvalidBase32Chars = /[0189]/.test(cleanSecret);
    
    let totp: TOTP;
    
    if (hasInvalidBase32Chars) {
      // Secret is likely hex encoded - convert to bytes and create Secret
      console.log('Secret appears to be hex-encoded, converting to bytes...');
      const secretBytes = hexToUint8Array(cleanSecret);
      const secretBuffer = secretBytes.buffer as ArrayBuffer;
      const secretObj = new Secret({ buffer: secretBuffer });
      totp = new TOTP({
        issuer: 'AngelOne',
        label: 'AngelOne',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: secretObj,
      });
    } else {
      // Secret is base32 encoded
      console.log('Secret is base32-encoded, using directly...');
      totp = new TOTP({
        issuer: 'AngelOne',
        label: 'AngelOne',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: cleanSecret,
      });
    }
    
    const code = totp.generate();
    console.log('Generated TOTP:', code);
    return code;
  } catch (error) {
    console.error('Failed to generate TOTP:', error);
    console.error('Original secret:', secret);
    throw new Error('Failed to generate TOTP');
  }
};
