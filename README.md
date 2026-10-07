# LocalSettle API

LocalSettle is an open-source peer-to-peer marketplace and wallet app built around Stellar. This repository contains the NestJS API that manages accounts, offers, orders, payment methods, chat, KYC status, direct transfer preparation, and escrow coordination.

The frontend lives in the companion [`iKash-frontend` repository](https://github.com/iKa-h/iKash-frontend). The applications are independently versioned repositories.

## Architecture

- `src/modules/` contains NestJS feature modules, including auth, offers, orders, escrow, Stellar, KYC, chat, users, and audit logging.
- `src/common/` contains guards, validation, errors, and shared request utilities.
- `prisma/schema.prisma` defines PostgreSQL data models; migrations and seed data live in `prisma/`.
- `test/` contains API and gateway end-to-end suites.

The API issues wallet challenge-response sessions, stores marketplace state through Prisma, prepares or relays Stellar transactions, integrates with Trustless Work for escrow, and receives Didit KYC webhooks. Escrow setup uses a configured platform operator key; inspect `src/modules/escrow/` and deployment configuration when reviewing trust assumptions.

## Local development

Requirements: Node.js 20+, npm, and a PostgreSQL database. Copy `.env.example` to `.env` and configure `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, Stellar network settings, and any integrations you plan to exercise. Never commit secrets.

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run start:dev
```

The API listens on port `3001` by default. Useful commands:

```bash
npm run build       # Compile the NestJS app
npm test            # Run Jest unit tests
npm run test:e2e    # Run API end-to-end tests
npm run test:cov    # Collect Jest coverage
```

## Security and data handling

Use allowlisted fields in audit metadata. Do not log wallet secrets, JWTs, passwords, webhook secrets, complete bank details, or raw identity documents. Configure production secrets in a secret manager and restrict access to the platform escrow signer. See [`docs/architecture.md`](docs/architecture.md) for component and data-flow notes.

## Contributing

Keep pull requests focused, explain user or maintainer impact, and include relevant test coverage. For Drips Wave participation, maintainers should submit the public GitHub repository through the Drips Wave app and nominate scoped issues after approval.
