export const JSON_BODY_LIMIT = '1mb';
export const URLENCODED_BODY_LIMIT = '256kb';

export const MULTIPART_FIELD_LIMITS = {
  fieldSize: 64 * 1024,
  fields: 20,
  parts: 25,
};

export const EVIDENCE_FILE_SIZE_LIMIT = 10 * 1024 * 1024;
export const PROFILE_IMAGE_SIZE_LIMIT = 5 * 1024 * 1024;

export const PAYLOAD_TOO_LARGE_RESPONSE = {
  statusCode: 413,
  error: 'PAYLOAD_TOO_LARGE',
  message: 'Request payload is too large',
};
