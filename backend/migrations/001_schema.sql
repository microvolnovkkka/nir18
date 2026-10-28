CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
    id uuid PRIMARY KEY,
    login text NOT NULL UNIQUE CHECK (login ~ '^[a-z][a-z0-9_]{2,31}$'),
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100 AND btrim(display_name) <> ''),
    password_hash text CHECK (password_hash IS NULL OR btrim(password_hash) <> ''),
    is_active boolean NOT NULL DEFAULT false,
    CHECK (NOT is_active OR password_hash IS NOT NULL)
);
CREATE TABLE directions (
    id smallint PRIMARY KEY,
    name text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 200 AND btrim(name) <> ''),
    position smallint NOT NULL UNIQUE CHECK (position > 0)
);
CREATE TABLE subtopics (
    id smallint PRIMARY KEY,
    direction_id smallint NOT NULL REFERENCES directions(id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300 AND btrim(name) <> ''),
    position smallint NOT NULL CHECK (position > 0),
    UNIQUE (direction_id, name),
    UNIQUE (direction_id, position)
);
CREATE TABLE sessions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token text NOT NULL CHECK (csrf_token ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE publications (
    id uuid PRIMARY KEY,
    author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    subtopic_id smallint NOT NULL REFERENCES subtopics(id) ON DELETE RESTRICT,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200 AND btrim(title) <> ''),
    markdown text NOT NULL CHECK (char_length(markdown) BETWEEN 1 AND 200000 AND octet_length(markdown) <= 800000 AND btrim(markdown) <> ''),
    updated_at timestamptz NOT NULL DEFAULT now(),
    revision_key uuid NOT NULL,
    UNIQUE(id, author_id)
);
CREATE INDEX publications_updated_idx ON publications(updated_at DESC, id DESC);
CREATE INDEX publications_author_idx ON publications(author_id, updated_at DESC, id DESC);
CREATE INDEX publications_subtopic_idx ON publications(subtopic_id, updated_at DESC, id DESC);
CREATE INDEX publications_search_idx ON publications USING gin ((title || E'\n' || markdown) gin_trgm_ops);
CREATE TABLE media (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    storage_key text NOT NULL UNIQUE CHECK (storage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'),
    original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
    mime_type text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
    byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
    width integer NOT NULL CHECK (width > 0),
    height integer NOT NULL CHECK (height > 0),
    sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
    state text NOT NULL DEFAULT 'staging' CHECK (state IN ('staging','ready','deleting')),
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz NOT NULL CHECK (lease_until >= uploaded_at),
    CHECK (width::bigint * height <= 20000000),
    UNIQUE (id, owner_id)
);
CREATE INDEX media_owner_idx ON media(owner_id);
CREATE INDEX media_lease_idx ON media(lease_until) WHERE state IN ('staging','ready','deleting');
CREATE TABLE publication_media (
    publication_id uuid NOT NULL,
    media_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    PRIMARY KEY (publication_id, media_id),
    FOREIGN KEY (publication_id, owner_id) REFERENCES publications(id, author_id) ON DELETE CASCADE,
    FOREIGN KEY (media_id, owner_id) REFERENCES media(id, owner_id) ON DELETE RESTRICT
);
CREATE INDEX publication_media_media_idx ON publication_media(media_id);
CREATE TABLE mutation_receipts (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key uuid NOT NULL,
    request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
    resource_id uuid NOT NULL,
    result_revision uuid,
    status_code smallint NOT NULL CHECK (status_code IN (200,201,204)),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
    PRIMARY KEY (user_id, key),
    CHECK ((status_code = 204 AND result_revision IS NULL) OR (status_code IN (200,201) AND result_revision IS NOT NULL))
);
CREATE INDEX mutation_receipts_expiry_idx ON mutation_receipts(expires_at);
