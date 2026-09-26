ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_failure_code_check;
ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_failure_code_check
  CHECK (failure_code IS NULL OR failure_code IN (
    'SCAN_UNAVAILABLE',
    'PROCESSING_UNAVAILABLE',
    'SOURCE_MISSING',
    'INVALID_IMAGE',
    'IMAGE_TOO_LARGE',
    'UNSUPPORTED_IMAGE',
    'INFECTED_FILE',
    'PROCESSING_FAILED',
    'UPLOAD_FAILED',
    'CHECKSUM_MISMATCH'
  ));
