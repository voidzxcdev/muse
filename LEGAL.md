# Legal

Muse is independent software. It is not affiliated with, endorsed by, or sponsored by YouTube, Google, or any record label.

## What the MIT license covers

[LICENSE](LICENSE) covers **Muse's own source code** only: the Python server, the web UI, and the desktop and Android shells.

It does **not** grant rights to songs, artwork, names, or trademarks that appear while using Muse. Those stay with their owners.

## Content

Muse does not sell a music catalog. It does not claim to be YouTube Music.

Playback depends on whatever catalog backend the operator configures. The stock server talks to public video platforms. That is an operator choice, not a content license from Muse.

If you run a copy of Muse:

- You are the operator.
- You must have a lawful basis for any search, stream, or cache you enable.
- You must not present Muse as an official Google or YouTube product.

## Clean room boundary

The product is split on purpose:

- **Client** (`static/`, `winapp/`, `linux/`, `android/`): talks only to Muse's own HTTP API. See [docs/CATALOG.md](docs/CATALOG.md).
- **Catalog adapter** (`server.py`): a replaceable backend. A second implementer can write a new adapter from `docs/CATALOG.md` without reading the stock adapter.

That is clean-room structure for **Muse's own API**. It is not a license for third-party media.

## Trademarks

YouTube, YouTube Music, and Google are trademarks of Google LLC. Muse, Musely, and getmuse.eu are used by this project. Do not copy third-party marks into skins, ads, or store listings.

## DMCA and takedowns

Muse does not host a public song archive. Library data (likes, playlists, profile) belongs to user accounts.

To report copyright abuse of material stored by this project (avatars, playlist covers, chat uploads):

Email **hello@getmuse.eu** with:

1. Your contact details
2. The work you own
3. The URL or user on getmuse.eu
4. A statement that you are authorized to act

We will review and remove hosted user files that we can actually delete.

We cannot license or un-license streams that never sit on our disk as a catalog.

## Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. See [LICENSE](LICENSE).
