import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it("redacts a private key block so the key material never reaches the model", () => {
    const input = [
      "$ cat id_rsa",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB",
      "AAAAMwb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAA",
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");

    const output = redactSecrets(input);

    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ");
    expect(output).not.toContain("BEGIN OPENSSH PRIVATE KEY");
    // surrounding non-secret context is preserved
    expect(output).toContain("$ cat id_rsa");
  });

  it("redacts API tokens (OpenAI sk- and GitHub gh* tokens)", () => {
    const openai = redactSecrets("OPENAI_API_KEY=sk-abc123DEF456ghi789jkl012mno345");
    expect(openai).toContain("[REDACTED]");
    expect(openai).not.toContain("sk-abc123DEF456");

    const github = redactSecrets("token: ghp_16C7e42F292c6912E7710c838347Ae178B4a01");
    expect(github).toContain("[REDACTED]");
    expect(github).not.toContain("ghp_16C7e42F292c6912");
  });

  it("redacts AWS access key ids", () => {
    const out = redactSecrets("aws_access_key_id = AKIAIOSFODNN7EXAMPLE");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redacts bearer tokens but keeps the scheme word so the line stays readable", () => {
    const out = redactSecrets("Authorization: Bearer eyJhbGciOiJIUzI1Ni.secret.Token123456");
    expect(out).toContain("Bearer");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("eyJhbGciOiJIUzI1Ni.secret.Token123456");
  });

  it("redacts password assignments but keeps the key name", () => {
    const out = redactSecrets("mysql -u root --password=Sup3rS3cret!Value");
    expect(out).toContain("password=");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("Sup3rS3cret!Value");
  });

  it("redacts the password inside a connection string url but keeps the host", () => {
    const out = redactSecrets("DATABASE_URL=postgres://admin:Hunter2Pass@db.example.com:5432/app");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("Hunter2Pass");
    expect(out).toContain("db.example.com");
  });

  it("leaves ordinary terminal output untouched (no false positives)", () => {
    const input = [
      "$ npm test",
      "  ✓ builds the project (1.2s)",
      "Listening on http://localhost:3000",
      "commit a1b2c3d  fix: handle empty input",
      "export PATH=/usr/local/bin:$PATH",
      "$ ssh deploy@prod.example.com",
      "$ git remote add origin git@github.com:acme/app.git",
    ].join("\n");
    expect(redactSecrets(input)).toBe(input);
  });

  it("does not treat the PWD environment variable as a password", () => {
    const input = "PWD=/Users/muki/Documents/project";
    expect(redactSecrets(input)).toBe(input);
  });

  it("redacts a private key block even when the closing marker was truncated away", () => {
    const input = [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB",
      "AAAAMwb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAA",
      "…[truncated]",
    ].join("\n");

    const output = redactSecrets(input);

    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ");
  });

  it("redacts the whole of a quoted password that contains spaces", () => {
    const output = redactSecrets('mysql --password="super secret value" -u root');

    expect(output).not.toContain("super secret value");
    expect(output).not.toContain("secret value");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("-u root");
  });
});
