> For the complete documentation index, see [llms.txt](https://docs.example.test/llms.txt).

# Getting started

This guide takes you from an empty project to your first tracked event. You need an Acme account and a project key, which you can find under Settings in the dashboard. Store the key in an environment variable rather than in source code.

## Install the SDK

Install the SDK with your package manager. The package works in Node 18 and later and in every modern browser, and has no runtime dependencies.

```bash
npm install @acme/sdk
```

## Send your first event

Create a client with your key and call track. Events show up in the dashboard within a few seconds. If nothing appears after a minute, check that the key belongs to the project you are looking at.

```js
const acme = new Acme({ key: process.env.ACME_KEY });
await acme.track('signup', { plan: 'free' });
```

## Next steps

Read the API reference to send events from a server, and set up batching before you go to production.
