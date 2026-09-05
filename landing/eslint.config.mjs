import next from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [".next/**", ".source/**", "out/**", "next-env.d.ts"],
  },
  ...next,
];

export default config;
