# Raspberry Pi Deployment (Retired)

This app no longer supports, needs, or documents Raspberry Pi (or any other
self-hosted machine) deployment. There is nothing left to run there:

- The web app itself runs exclusively as a Vercel serverless function (see
  `README.md` and `docs/vercel-migration-plan.md`).
- The Telegram bot that used to be the Pi's one remaining job has been
  removed entirely — `telegram-bot.js` is an inert placeholder that does
  nothing, the Telegram Prisma models are gone from `prisma/schema.prisma`,
  and the `npm run telegram:bot` script no longer exists.
- The `deploy/triple-dimension.service.example` and
  `deploy/triple-dimension-bot.service.example` systemd unit files are
  likewise retired and do nothing if used.

There is no supported path for running any part of this application on a
Raspberry Pi, a home server, or any other self-hosted machine. If you have
an old Pi that used to run this app, it can be decommissioned — nothing in
production depends on it.

This file is kept only as an inert placeholder because this deployment
cannot delete files from the repository.
