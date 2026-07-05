import { build, emptyDir } from "@deno/dnt";

await emptyDir("./npm");

await build({
  entryPoints: ["./src/table.ts"],
  outDir: "./npm",
  scriptModule: false,
  compilerOptions: {
    lib: ["DOM"],
  },
  shims: {
    deno: true,
  },
  package: {
    name: "@marmooo/table",
    version: "0.0.0",
    description: "A dependency-free HTML <table> library.",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/marmooo/table.git",
    },
    bugs: {
      url: "https://github.com/marmooo/table/issues",
    },
  },
  postBuild() {
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});
