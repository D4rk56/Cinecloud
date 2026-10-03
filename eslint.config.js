const js = require("@eslint/js");
const prettierConfig = require("eslint-config-prettier");

module.exports = [
    {
        ignores: ["node_modules/**", "data/**", "package-lock.json"]
    },
    js.configs.recommended,
    prettierConfig,
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "commonjs",
            globals: {
                // Node.js runtime globals
                Buffer: "readonly",
                __dirname: "readonly",
                __filename: "readonly",
                clearImmediate: "readonly",
                clearInterval: "readonly",
                clearTimeout: "readonly",
                console: "readonly",
                exports: "writable",
                global: "readonly",
                module: "readonly",
                process: "readonly",
                require: "readonly",
                setImmediate: "readonly",
                setInterval: "readonly",
                setTimeout: "readonly",
                // Standard Web & Node built-in globals
                URL: "readonly",
                URLSearchParams: "readonly",
                AbortController: "readonly",
                fetch: "readonly",
                Response: "readonly",
                Request: "readonly",
                Headers: "readonly",
                FormData: "readonly",
                structuredClone: "readonly",
                btoa: "readonly",
                atob: "readonly",
                TextEncoder: "readonly",
                TextDecoder: "readonly"
            }
        },
        rules: {
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
            "no-empty": ["warn", { allowEmptyCatch: true }],
            "no-constant-condition": ["warn", { checkLoops: false }],
            "no-useless-escape": "off",
            "no-control-regex": "off",
            "no-useless-assignment": "warn"
        }
    }
];
