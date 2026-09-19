# LinkedIn connector

Publishes posts to the connected member's **personal profile**. Each post is a
Home block of kind `linkedin-post`, created from the Block Builder like a QR
block: its text and link live in the block record, and this connector owns only
the session and the publish state.

Lifecycle: `beta` (0.1.0). Tier: `community`. The contract can still change:
publishing as a Company Page, images and the scheduled queue are not built yet.

## What LinkedIn allows (and what it does not)

| Self-serve product | Scopes | Gives |
| --- | --- | --- |
| Sign In with LinkedIn using OpenID Connect | `openid profile` | `sub`, name, picture. **Not the headline.** |
| Share on LinkedIn | `w_member_social` | `POST /rest/posts` as the member |

There is **no self-serve read API** for a member's feed, their own posts, post
analytics, connections, notifications or search. Those need the Community
Management API, which is partner-gated and scoped to Company Pages. This
connector therefore never claims to read anything back from LinkedIn: the
`published` block lists what *Lintaya* published, from its own records.

## Setting up the app

1. LinkedIn requires every developer app to be **associated with a Company Page
   you administer**, verified from that Page. A minimal empty Page is enough —
   posts still go out as your personal profile.
2. Create the app at <https://www.linkedin.com/developers/apps> and add the
   products *Sign In with LinkedIn using OpenID Connect* and *Share on
   LinkedIn* (both granted automatically).
3. In **Auth → Authorized redirect URLs**, register the callback for every
   origin you open Lintaya from:
   - `http://localhost:3000/api/connectors/linkedin/oauth/callback`
   - `http://localhost:3001/api/connectors/linkedin/oauth/callback`

   LinkedIn accepts `http://` **only for `localhost`**. On a LAN mini-server
   without a certificate, authorize from the browser of the machine that runs
   the server; from a phone, `localhost` points at the phone.
4. Paste the Client ID and Client Secret in the connector panel, save, then
   press **Connect LinkedIn**. The password is typed on LinkedIn's own page;
   Lintaya only receives a single-use authorization code.

### Several connections

The connector is `instantiable`: each connection is its own LinkedIn app, with
its own Client ID, session, OAuth `state` and posts. The typical split is the
personal profile on one app (*Sign In* + *Share on LinkedIn*) and a Company
Page on another, because LinkedIn only lets the Community Management API be
requested from an app with no other products.

Each connection has its own callback, built from its id, and each one must be
registered in the app it uses:

- `http://localhost:3000/api/connectors/linkedin/oauth/callback`
- `http://localhost:3000/api/connectors/linkedin2/oauth/callback`

A `linkedin-post` block belongs to one connection (`connectorId`) and can only
be published through it.

Publishing *as the Page* (`urn:li:organization:<id>`) is not built yet: it
needs the Community Management API scopes, which LinkedIn grants only after
review. Until then a second connection still publishes as the member who
authorized it.

### Token lifetime

Access tokens last **60 days**. Standard apps get **no refresh token** — the
token response simply omits it. Only apps with approved Marketing Developer
Platform products (in practice, the *Advertising API* product) receive one,
valid for a year. The refresh path is implemented and used automatically when
a refresh token exists; otherwise the panel warns 10 days before expiry and the
member reconnects by hand.

## Routes

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/connectors/linkedin/config` | yes | `{ configured, clientId, headline, hasSecret, connected }` — never a secret |
| POST | `/api/connectors/linkedin/config` | yes | Save `clientId`, `clientSecret`, `headline`. An empty secret keeps the stored one; a different `clientId` drops the session |
| POST | `/api/connectors/linkedin/test` | yes | Checks the session against `/v2/userinfo` |
| GET | `/api/connectors/linkedin/profile` | yes | Name, picture, headline, expiry — never the token |
| GET | `/api/connectors/linkedin/oauth/start` | yes | `{ url }` to open in a popup |
| GET | `/api/connectors/linkedin/oauth/callback` | **no** | Opened by LinkedIn. Protected by the `state`: 32 random bytes, single use, 10-minute expiry, stored server-side |
| GET | `/api/connectors/linkedin/posts/:blockId` | yes | `{ status, postUrn, postUrl, publishedAt, error, staleContent }` |
| POST | `/api/connectors/linkedin/posts/:blockId/publish` | yes | Runs the `publish-post` action. The server reads the text from the block; it never accepts it from the client |
| POST | `/api/connectors/linkedin/posts/:blockId/dismiss-unconfirmed` | yes | Releases an unconfirmed attempt once the member checked LinkedIn |
| POST | `/api/connectors/linkedin/posts/:blockId/forget-published` | yes | The member deleted the post on LinkedIn by hand: forgets the local record so the block is a draft again. Calls nothing on LinkedIn — it cannot check whether a post still exists (`r_member_social` is closed) |
| GET | `/api/connectors/linkedin/blocks/published` | yes | Standard list block |

No route ever answers **401** for a LinkedIn problem: the frontend treats any
401 as an expired *Lintaya* session and logs the user out. LinkedIn session
problems are 400 with a `linkedin-*` code.

## Blocks

LinkedIn exposes nothing to read about a personal profile, so every block is
built from what Lintaya itself knows: the stored session, the `linkedin-post`
blocks and the publish records. They are plain list blocks, so they work the
same in Home, boards, the CLI and the MCP server.

| Block | Shows |
| --- | --- |
| `account` | Connected member, headline, days left on the authorization (warning at 10 or fewer, red once expired), posts published from Lintaya |
| `pending` | `linkedin-post` blocks not yet published; unconfirmed and failed attempts first, then drafts, newest first |
| `activity` | Days since the last post (warning past 14), posts in the last 7 days, this month and in total, pending drafts |
| `published` | Posts published from Lintaya, newest first, linking to LinkedIn |

## Actions

| Id | Effect | Notes |
| --- | --- | --- |
| `publish-post` | `write` | Input `{ blockId }` |
| `delete-post` | `destructive` | Goes through the Approval Center: the first request is pending and never reaches LinkedIn |

## Publishing without duplicates

LinkedIn has **no idempotency key** and no way to ask whether a post was
created. The guarantee comes from ordering: the intent is written *before*
calling LinkedIn, and the result after.

```
connector-data-linkedin.posts[blockId]
  publishing  → written before the call (startedAt)
  published   → postUrn, postUrl, publishedAt, contentHash
  failed      → a clear 4xx rejection; safe to retry
```

- A `publishing` record younger than 2 minutes is an in-flight request
  (`linkedin-publish-in-progress`); older, it is an attempt that died
  (`linkedin-publish-unconfirmed`). Neither calls LinkedIn again.
- A network error, a 5xx, or a 2xx without `x-restli-id` is **ambiguous** — the
  post may exist — and is recorded as unconfirmed, never as a retryable failure.
- Publishing the same content again returns the existing post. Publishing an
  edited block that already went out is refused (`linkedin-already-published`)
  rather than creating a second post; the panel says LinkedIn still shows the
  original text (`staleContent`).

A queue-style arm → witness → publish protocol only adds guarantees across
separate job steps with a transactional lock. Within one HTTP request it
reduces to the ordering above. The scheduler phase will need a real lease.

## Request details

- `POST https://api.linkedin.com/rest/posts` with `LinkedIn-Version: 202601`
  and `X-Restli-Protocol-Version: 2.0.0`. The post URN comes back in the
  **`x-restli-id` response header**, not the body. Permalink:
  `https://www.linkedin.com/feed/update/<urn>`.
- The URN may be `urn:li:share:`, `urn:li:ugcPost:` or `urn:li:activity:` and
  they are not interchangeable across endpoints; it is stored exactly as
  returned.
- `commentary` uses LinkedIn's "little text" format: `\ < > # ~ _ | [ ] * ( )
  { } @` must be backslash-escaped, in a single pass.
- The link is appended to the end of the text — that is how it publishes — so
  it counts toward the 3000-character limit. Characters are counted as code
  points (an emoji is one), the same in `client.js`,
  `server/routes/custom-blocks.js` and the Block Builder counter.
- The client uses `fetch` instead of the SDK's `requestJson`: the token
  exchange is a form post, and the post id is in a response header.

## Storage

| Key | Content |
| --- | --- |
| `connector-config-linkedin` | `clientId`, `headline`, `authorUrn`, `sub`, `name`, `picture`, `scopes`, `expiresAt` |
| secret store (`SECRET_FIELDS`) | `clientSecret`, `accessToken`, `refreshToken` |
| `connector-data-linkedin` | `{ posts: { [blockId]: record } }` |
| `linkedin-oauth-states-linkedin` | Pending OAuth `state` values |
| `custom-blocks` | The post blocks themselves (kind `linkedin-post`) |

## Error codes

`linkedin-credentials-required`, `linkedin-not-connected`,
`linkedin-token-expired`, `linkedin-oauth-failed`, `linkedin-request-failed`,
`linkedin-block-not-found`, `linkedin-body-required`, `linkedin-body-too-long`,
`linkedin-invalid-link`, `linkedin-already-published`,
`linkedin-publish-in-progress`, `linkedin-publish-unconfirmed`,
`linkedin-publish-failed`, `linkedin-post-not-published`,
`linkedin-delete-failed`, `linkedin-nothing-to-dismiss`.

## Not yet

- Images (three-step upload; processing status is only pollable with an
  organization token), the link as first comment, the scheduled queue.
- Publishing as a Company Page (`urn:li:organization:`), once the Community Management API is
  approved.
- A `linkedin-post` block is not portable in a workspace package export.
