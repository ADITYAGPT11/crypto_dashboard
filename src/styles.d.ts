declare module '*.scss' {
  const classes: { [key: string]: string };
  export default classes;
}

interface ImportMetaEnv {
  readonly VITE_ANGLEONE_API_KEY: string;
  readonly VITE_ANGLEONE_CLIENT_CODE: string;
  readonly VITE_ANGLEONE_TOTP_SECRET: string;
  readonly VITE_USE_PROXY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
