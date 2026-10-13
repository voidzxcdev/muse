# Muse catalog contract

This is the clean-room spec for Muse's **own** HTTP API. The web and desktop clients may call only these routes. They must not speak YouTube, Innertube, or any other vendor protocol.

A second team can implement a new catalog adapter from this file alone.

## Search

`GET /api/search?q=&n=`

Returns `{ results: [{ id, title, duration, thumbnail }], music_only: true }`.

`id` is an opaque catalog key for this adapter. The client treats it as a string.

## Play

`GET /api/play?v=`

Returns stream metadata the player needs: title, duration, thumbnail, and either:

- an `audio_url` on the same origin, or
- enough data for the desktop shell to use an official embed

`GET /api/audio?v=` is a Range-aware same-origin audio response when the adapter uses files or proxied audio.

## Library

Accounts, playlists, likes, and For You are Muse application data. They live in the operator's database. They are not a music license.

Documented in the README API list. Adapters that cannot recommend may return an empty mix.

## Rules for adapters

1. Do not copy vendor client source into Muse.
2. Do not ship vendor API keys in the git tree.
3. Do not add a "save MP3" export of catalog media.
4. Prefer an official embed or a catalog you are licensed to stream.
5. If you cannot meet (4), do not run the adapter in production.

The stock tree may still contain a legacy adapter. Running it is the operator's legal problem, not a right granted by this spec.
