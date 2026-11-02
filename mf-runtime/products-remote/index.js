// Pure remote: this app only exists to build and serve the Module Federation
// container (products.container.bundle). It is never run as a standalone app,
// so the entry registers nothing — the exposed modules live in rspack.config.mjs.
export {};
