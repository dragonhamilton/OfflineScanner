-- OfflineScanner — initial schema

CREATE TABLE photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name     text NOT NULL,          -- relative to DATA_DIR/photos
  original_name text NOT NULL DEFAULT '',
  width         integer NOT NULL,
  height        integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per spine found in a photo, or per book added by hand.
-- Everything stored here comes from the image itself; there is no lookup.
CREATE TABLE books (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id       uuid REFERENCES photos(id) ON DELETE SET NULL,
  position       integer,               -- left-to-right in the photo, from 1
  image_file     text,                  -- relative to DATA_DIR/spines
  width_px       integer,
  height_px      integer,
  color          text,                  -- dominant colour, '#rrggbb'
  raw_ocr        text NOT NULL DEFAULT '',
  ocr_lines      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ocr_confidence real,                  -- 0..1, NULL until OCR has run
  title          text NOT NULL DEFAULT '',
  author         text NOT NULL DEFAULT '',
  publisher      text NOT NULL DEFAULT '',
  notes          text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'unreviewed'
                 CHECK (status IN ('unreviewed', 'confirmed', 'skipped')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX books_photo_idx  ON books (photo_id, position);
CREATE INDEX books_status_idx ON books (status);
