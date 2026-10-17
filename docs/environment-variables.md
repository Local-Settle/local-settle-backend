# Backend environment variables

Keep production values in the deployment platform's secret manager. The values
in `.env.example` are placeholders; never put live credentials there. Required
settings below are checked during startup (tests skip this check unless
`ENFORCE_ENV_VALIDATION` is set).

| Variable | Required | Default / selection | Sensitive |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | None | Yes: database credential |
| `JWT_SECRET` | Yes | None; at least 32 characters | Yes: signing secret |
| `STELLAR_HORIZON_URL` | Yes | None | No |
| `STELLAR_NETWORK` | Yes | None; select the intended Stellar network | No |
| `STELLAR_SIGNER_SECRET` | Yes | None | Yes: wallet secret |
| `TRUSTLESS_WORK_API_URL` | Yes | None; use the matching environment | No |
| `TRUSTLESS_WORK_API_KEY` | Yes | None | Yes: API credential |
| `TRUSTLESS_WORK_USDC_ISSUER` | Yes | None; network-specific issuer | No |
| `DIDIT_API_KEY` | Yes | None | Yes: API credential |
| `DIDIT_WEBHOOK_SECRET` | Yes | None | Yes: webhook secret |
| `DIDIT_API_URL` | Yes | `https://verification.didit.me/v3` | No |
| `DIDIT_WORKFLOW_ID` | Yes | None | Treat as configuration; do not log |
| `KYC_CALLBACK_URL` | Yes | None; public application callback URL | No |
| `DIRECT_URL` | Optional | None; Prisma direct connection | Yes: database credential |
| `STELLAR_RPC_URL` | Optional | `https://soroban-testnet.stellar.org` | No |
| `STELLAR_LISTENER_POLL_INTERVAL_MS` | Optional | `5000` | No |
| `TRUSTLESS_WORK_CONTRACT_ID` | Optional | Empty; listen to configured escrow contracts | No |
| `TRUSTLESS_WORK_XLM_ADDRESS` | Optional | None | No |
| `IKASH_TREASURY_ADDRESS` | Optional | None | No: public Stellar address |
| `IKASH_SUPPORT_ADDRESS` | Optional | None | No: public Stellar address |
| `IKASH_DEPLOYER_SECRET` | Optional | None | Yes: wallet secret |
| `IKASH_PLATFORM_FEE` | Optional | `1` | No |
| `CHAT_SUPPORT_USER_IDS` | Optional | Empty | No |
| `CHAT_SUPPORT_PUBLIC_KEYS` | Optional | Empty | No: public keys |
| `STORAGE_PROVIDER` | Optional | `mock`; use `gcs` in deployment | No |
| `GCS_BUCKET_NAME` | Optional | `ikash-profile-images` | No |
| `GCS_PROJECT_ID` | Optional | Deployment project default | No |
| `STORAGE_ENDPOINT` | Optional | Empty; Google Cloud Storage default | No |
| `MOCK_PROFILE_UPLOAD` | Optional | `false` | No; local development only |
| `PRISMA_QUERY_LOG` | Optional | `false` | No; development only |
| `SEND_CRYPTO_FEE_PERCENT` | Optional | `0.3` | No |
| `AUTH_CHALLENGE_EXPIRATION_SECONDS` | Optional | `300` | No |
| `PORT` | Optional | `3001` | No |
| `NODE_ENV` | Optional | Runtime platform default | No |
| `FRONTEND_URL` | Optional | Empty; allow-listed frontend origin | No |
| `TRUST_PROXY` | Optional | `1` | No |
| `CSRF_COOKIE_SAME_SITE` | Optional | `lax` outside production, `none` in production | No |
| `ENFORCE_ENV_VALIDATION` | Optional | Unset; enables validation in tests when set | No |
| `RATE_LIMIT_DEFAULT_MAX` | Optional | `100` | No |
| `RATE_LIMIT_DEFAULT_TTL_MS` | Optional | `60000` | No |
| `RATE_LIMIT_AUTH_MAX` | Optional | `5` | No |
| `RATE_LIMIT_AUTH_TTL_MS` | Optional | `60000` | No |
| `RATE_LIMIT_REGISTRATION_MAX` | Optional | `10` | No |
| `RATE_LIMIT_REGISTRATION_TTL_MS` | Optional | `60000` | No |
| `RATE_LIMIT_ALIAS_VALIDATION_MAX` | Optional | `30` | No |
| `RATE_LIMIT_ALIAS_VALIDATION_TTL_MS` | Optional | `60000` | No |
| `RATE_LIMIT_KYC_START_MAX` | Optional | `5` | No |
| `RATE_LIMIT_KYC_START_TTL_MS` | Optional | `60000` | No |
| `RATE_LIMIT_KYC_WEBHOOK_MAX` | Optional | `20` | No |
| `RATE_LIMIT_KYC_WEBHOOK_TTL_MS` | Optional | `60000` | No |

`STELLAR_NETWORK`, the Stellar URLs, the Trustless Work URL and issuer must all
refer to the same network. Use secret-manager entries for database URLs, JWT
and signer secrets, and API/webhook credentials. Avoid printing configuration
values in logs; report missing variable names only.
