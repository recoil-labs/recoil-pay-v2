//! OpenAPI document for the public integration surface.
//!
//! Served as Swagger UI at `/swagger-ui` and as raw JSON at
//! `/api-docs/openapi.json`, both behind the `openapi` cargo feature and
//! both allowlisted in `auth::middleware` so they are reachable
//! anonymously (see the public-path list there).
//!
//! Scope: this documents the **partner integration surface** — the routes
//! a developer forwarding intents to RecoilPay needs. It deliberately
//! omits `/solver-api/*`, which is authenticated operator tooling with a
//! different audience and its own docs.
//!
//! No `servers` block is declared on purpose. Swagger UI then resolves
//! requests relative to whatever origin served the page, so "Try it out"
//! works on localhost, on a preview deploy, and in production without a
//! hardcoded hostname that would go stale the moment the service moves.

use utoipa::OpenApi;

use oif_service::SolverStats;
use oif_types::models::health::{HealthResponse, StorageHealthInfo};
use oif_types::orders::request::OrderRequest;
use oif_types::orders::response::OrderResponse;
use oif_types::quotes::request::QuoteRequest;
use oif_types::quotes::response::QuotesResponse;
use oif_types::solvers::response::{SolverResponse, SolversResponse};

use crate::handlers::chains::ChainsResponse;
use crate::handlers::intents::{ParseIntentRequest, ParseIntentResponse};
use crate::intent_parser::{AmountKind, IntentAction, RawIntent};

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::handlers::health::health,
        crate::handlers::chains::get_chains,
        crate::handlers::intents::post_parse_intent,
        crate::handlers::solvers::get_solvers,
        crate::handlers::solvers::get_solver_by_id,
        crate::handlers::quotes::post_quotes,
        crate::handlers::orders::post_orders,
        crate::handlers::orders::get_order,
    ),
    components(schemas(
        QuoteRequest, QuotesResponse,
        OrderRequest, OrderResponse,
        SolverResponse, SolversResponse,
        ChainsResponse,
        ParseIntentRequest, ParseIntentResponse, RawIntent, IntentAction, AmountKind,
        HealthResponse, StorageHealthInfo, SolverStats
    )),
    tags(
        (name = "intents", description = "Turn a plain-English request into structured swap and send intents."),
        (name = "quotes", description = "Price an intent against every eligible solver in parallel."),
        (name = "orders", description = "Submit a signed order and track it to settlement."),
        (name = "chains", description = "Supported chains, settlement contracts, and token metadata."),
        (name = "solvers", description = "Registered solvers and the assets each can fill."),
        (name = "health", description = "Liveness and storage diagnostics.")
    ),
    info(
        title = "RecoilPay Aggregator API",
        version = "0.1.0",
        description = "\
The public API for forwarding intents to RecoilPay. Four calls make a \
complete integration:

1. `POST /api/v1/quotes` — price the intent; each quote carries ready-to-sign \
   EIP-712 typed data in `order.payload`.
2. Your user signs that payload with their wallet and you prefix the \
   signature with a scheme byte (`0x00` for `oif-escrow-v0`).
3. `POST /api/v1/orders` — submit the quote **verbatim** plus the signature. \
   The quote's `integrityChecksum` is re-verified here, so any mutation is \
   rejected.
4. `GET /api/v1/orders/{id}` — poll. `executed` means the funds have landed.

**Testnet only.** Optimism Sepolia, Base Sepolia, Polygon Amoy, and Ethereum \
Sepolia. The tokens are mock ERC-20s with no real value.

**No authentication.** Users authorise with an on-chain signature over the \
order itself rather than an account here, so these routes are anonymous by \
design.

**Try it out works for everything except `POST /api/v1/orders`**, which needs \
a wallet signature this page cannot produce. Use it to explore quotes, \
solvers, chains, and order status; sign in your own client.

Narrative guides, a reference ERC-7930 address encoder, and the signing \
walkthrough: https://docs.recoilpay.com/integrate/",
        contact(
            name = "RecoilPay",
            url = "https://docs.recoilpay.com/integrate/"
        ),
    ),
)]
pub struct ApiDoc;
