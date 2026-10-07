# LocalSettle Architecture

LocalSettle is a Stellar-based peer-to-peer marketplace and wallet application. Its client and API are separate Git repositories: `LocalSettle-frontend/` contains the Next.js app, and this repository contains the NestJS API.

## Components

| Component | Implementation | Responsibility |
| --- | --- | --- |
| Web client | Next.js, React, TypeScript | Wallet connection and signing, product UI, order chat, transaction history |
| API | NestJS, TypeScript | Authentication challenges, business rules, order state, transaction preparation, webhooks, audit events |
| Database | PostgreSQL through Prisma | Users, offers, orders, escrow references, payment methods, messages, audit records |
| File storage | Google Cloud Storage or mock provider | User uploads and payment evidence |
| Stellar | Horizon and Soroban RPC | Account/transaction reads and escrow event monitoring |
| External services | Trustless Work, Didit | Escrow API operations and hosted identity verification |

## Main flows

### Wallet authentication

The API issues a short-lived challenge for a Stellar public key. The browser asks the connected wallet to sign it, then submits the signature for verification. On success, the API creates or loads the user and issues a JWT. The frontend also obtains a CSRF token for state-changing requests.

### P2P trade and escrow

Users create offers and orders in the marketplace. When an order is opened, the API requests Trustless Work to deploy a multi-release escrow and signs the deployment with the configured platform operator key. It stores the contract ID and returns an unsigned funding XDR for the seller's wallet. Local payment coordination happens off-chain through order chat, payment details, and evidence uploads. Escrow status is synchronized from Stellar events and API operations.

### Direct USDC transfer

The API resolves a Stellar address or LocalSettle alias, calculates the configured service fee, and builds an unsigned USDC transaction. The frontend asks the user's wallet to sign the XDR and submits it to the API for broadcast.

## Trust and data boundaries

- User wallet keys are managed by the selected wallet provider; the frontend requests signatures for user actions.
- The backend has a separate configured operator secret for escrow deployment. Protect it as a high-impact production credential.
- Fiat transfers occur outside Stellar and are not settled by the API.
- Application data includes wallet public keys, profile and KYC status, payment methods, order/chat records, escrow references, and selected audit context.
- The current application has no in-app refund operation. Do not describe cancellation as a reversal after funds enter escrow.

This document describes code paths and configuration present in the repository. Deployment behavior also depends on environment variables, external service configuration, and the contracts used by Trustless Work.
