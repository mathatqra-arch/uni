import fs from "node:fs";

const file = fs.readFileSync("src/desktop/desktop-app.tsx", "utf8");
const required = [
  "const { activeModule, setModule, theme } = useUIStore()",
  "setModule('pos')",
  "[licenseStatus, setupStatus, user, setModule]",
];
for (const fragment of required) {
  if (!file.includes(fragment)) {
    console.error(`Missing DesktopApp runtime binding fragment: ${fragment}`);
    process.exit(1);
  }
}
console.log("DesktopApp runtime binding verification PASS");
