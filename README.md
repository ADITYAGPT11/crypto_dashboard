# Crypto Dashboard

A React-based cryptocurrency dashboard with real-time data visualization and trading API integration.

## Angel One Smart API Integration

This project integrates with Angel One Smart API for option chain data. Due to CORS restrictions in browsers, a proxy server is required to make API calls to Angel One.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and update with your credentials:

```bash
cp .env.example .env
```

Update the following variables in `.env`:
- `VITE_ANGLEONE_API_KEY` - Your Angel One Smart API key
- `VITE_ANGLEONE_CLIENT_CODE` - Your Angel One client code
- `VITE_ANGLEONE_TOTP_SECRET` - Your TOTP secret key
- `VITE_USE_PROXY` - Set to `true` (default) to use the proxy server

### 3. Start the Application

#### Option A: Start Both Proxy and Dev Server (Recommended)

```bash
npm run dev:all
```

This will start:
- Frontend dev server on `http://localhost:3000`
- Proxy server on `http://localhost:3001`

#### Option B: Start Servers Separately

In terminal 1 - Start the proxy server:
```bash
npm run proxy
```

In terminal 2 - Start the frontend:
```bash
npm run dev
```

## How the Proxy Works

1. **Browser Request**: The frontend makes requests to `/api/angelone/*`
2. **Vite Proxy**: In development, Vite forwards these to `http://localhost:3001`
3. **Express Proxy**: The proxy server forwards the request to Angel One API
4. **Response**: Angel One's response is passed back through the proxy to the frontend

This bypasses CORS restrictions since the proxy server (running on Node.js) can make cross-origin requests.

## Development

### Available Scripts

- `npm run dev` - Start the Vite development server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run proxy` - Start the Angel One API proxy server
- `npm run dev:all` - Start both proxy and dev server

### Production Deployment

For production, you have two options:

1. **Use the proxy**: Deploy the proxy server alongside your frontend
2. **Backend integration**: Handle API calls from your own backend server

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      ...tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      ...tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      ...tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
