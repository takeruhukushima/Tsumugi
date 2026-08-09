-- Bluesky OAuth sessions now live in the browser's IndexedDB.
-- D1 retains only public identity/channel/video/sync metadata.
DROP TABLE IF EXISTS atp_sessions;
DROP TABLE IF EXISTS atp_states;

