// Where the website sends its requests. '/api' is the backend Worker on this same site (worker/index.mjs).
// Make it an empty string ('') to run in DEMO MODE: fake data kept in your browser only, admin password is "admin".
window.SWC_CONFIG = {
  API_URL: '/api',
};
