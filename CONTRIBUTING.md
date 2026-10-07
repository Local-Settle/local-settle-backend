# Contributing to LocalSettle

Thanks for helping improve LocalSettle. This repository contains the NestJS API and integration services. Coordinate API contract changes with the companion frontend repository.

## Before you start

- Check existing issues and pull requests before starting substantial work. For larger changes, open an issue to agree on scope.
- Keep changes focused and follow the current NestJS module and service structure under `src/modules/`.
- Never commit secrets, private keys, tokens, real financial details, or identity documents. Do not add sensitive values to logs, fixtures, or pull request screenshots.

## Set up and work locally

Use Node.js 20+ and npm. Copy `.env.example` to `.env`, configure a local PostgreSQL database and required environment values, then run:

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run start:dev
```

Keep schema changes in Prisma migrations. Update validation, API documentation, and frontend-facing contracts when an endpoint or response changes. Never weaken authorization or expose operator signing secrets.

## Checks and tests

Add or update regression coverage for behavior changes. Jest unit tests use `*.spec.ts` files; end-to-end tests live under `test/` and use the configured e2e suite.

```bash
npm test
npm run test:e2e
npm run build
```

Run the relevant checks before opening a pull request and report any checks you could not run. Use `npm run format` for Prettier formatting when needed.

## Commits and pull requests

Use concise Conventional Commit style, for example `feat: add order status endpoint` or `fix: reject expired auth challenge`. Keep commits focused. A pull request should explain the impact and implementation, link related issues, list validation performed, and identify environment, migration, or API contract changes. Include example requests or responses for API changes where useful.

## Security reports

Do not disclose vulnerabilities, credentials, or sensitive user information in public issues. Contact the maintainers privately through the GitHub repository's security reporting channel.
