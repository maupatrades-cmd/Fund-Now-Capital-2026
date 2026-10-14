import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const helper = await readFile(new URL("../src/lib/signingReturnPath.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(helper, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
});
const { signingReturnPath, passwordChangeLocation } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const link = `/sign/${"a1".repeat(32)}`;

test("ordinary sign-in preserves its signing link, without changing normal portal login", () => {
  assert.equal(signingReturnPath({ pathname: link }), link);
  assert.equal(signingReturnPath({ pathname: "/" }), null);
  assert.equal(signingReturnPath({ pathname: "/", state: { signingReturnTo: link } }), null);
});

test("required password change retains the signing link through sign-out and a fresh login", () => {
  const destination = passwordChangeLocation({ pathname: link });
  assert.equal(destination.pathname, "/change-password");
  assert.deepEqual(destination.state, { signingReturnTo: link });
  // Both the change-password page and its signed-out route resolve this path.
  const loginPath = signingReturnPath(destination);
  assert.equal(loginPath, link);
  assert.equal(signingReturnPath({ pathname: loginPath }), link);
  assert.deepEqual(passwordChangeLocation({ pathname: "/contractor" }), {
    pathname: "/change-password", state: null,
  });
});

test("untrusted return destinations cannot produce external or alternate-route redirects", () => {
  for (const path of [
    "https://evil.example/sign/token", "//evil.example/sign/token", "\\\\evil.example\\sign\\token",
    "/sign/../dashboard", "/sign/%2f%2fevil.example", "/sign/token/other",
    "/sign/token?next=https://evil.example", "/sign/token#fragment", "/dashboard",
    "/sign/", `/sign/${"a".repeat(257)}`, "/sign/token\n", null, 42, {},
  ]) {
    assert.equal(signingReturnPath({ pathname: "/change-password", state: { signingReturnTo: path } }), null);
    if (typeof path === "string") assert.equal(signingReturnPath({ pathname: path }), null);
  }
  for (const state of [undefined, null, "https://evil.example", 42, {}, []]) {
    assert.equal(signingReturnPath({ pathname: "/change-password", state }), null);
  }
});

test("all authentication transitions use the validated signing return path", async () => {
  const [app, auth, change] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/AuthPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/ChangePasswordPage.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(app, /passwordChangeLocation\(location\)/);
  assert.match(app, /to=\{signingReturnPath\(location\) \?\? "\/"\}/);
  assert.match(auth, /passwordChangeLocation\(location\)/);
  assert.match(auth, /const returnTo = signingReturnPath\(location\);\s*if \(returnTo\)/);
  assert.match(change, /navigate\(signingReturnPath\(location\) \?\? "\/"/);
});
