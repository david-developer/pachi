import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

// Verified against the signed npm package and digitalbazaar/forge v1.4.3.
// https://registry.npmjs.org/node-forge/1.4.3
const forgeIntegrity = 'sha512-P6wzfh6t70avmV8FrVEAd/36sOPJQ+hkaJVX1Laap9J/77m7M0eyozDvc8SwnDf4P7MP94gwbAAo0rg3YVXT+g==';
const rsaSha256 = '6632e195295ce76f6bb9131ee770dcd6cc1ee4ffac7906302208b00faf95a87f';

function consumers() {
  const mobile = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
  const expo = createRequire(mobile.resolve('expo/package.json'));
  const cli = createRequire(expo.resolve('@expo/cli/package.json'));
  const signing = createRequire(cli.resolve('@expo/code-signing-certificates/package.json'));
  return { cli, signing };
}

const fixture = process.argv[2] === '--forge-compatibility-fixture' ? process.argv[3] : undefined;
if (fixture) {
  if (fixture === 'signing') checkSigning();
  else if (fixture === 'nested-digest') checkNestedDigest();
  else if (fixture === 'name-constraints') checkNameConstraints();
  else assert.fail('Unknown Forge compatibility fixture');
} else {
  test('actual Expo CLI and signing consumers resolve the authentic patched Forge package', () => {
    const { cli, signing } = consumers();
    assert.equal(cli('./package.json').version, '55.0.11');
    assert.equal(signing('./package.json').version, '0.0.6');
    assert.equal(realpathSync(cli.resolve('node-forge')), realpathSync(signing.resolve('node-forge')));
    for (const consumer of [cli, signing]) {
      assert.equal(consumer('node-forge/package.json').version, '1.4.3');
      assert.equal(createHash('sha256').update(readFileSync(consumer.resolve('node-forge/lib/rsa.js'))).digest('hex'), rsaSha256);
    }
    const documents = parseAllDocuments(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'));
    assert.ok(documents.every(document => document.errors.length === 0));
    const packages = Object.assign({}, ...documents.map(document => document.toJSON().packages ?? {}));
    assert.deepEqual(Object.keys(packages).filter(key => key.startsWith('node-forge@')), ['node-forge@1.4.3']);
    assert.equal(packages['node-forge@1.4.3'].resolution.integrity, forgeIntegrity);
  });

  for (const [name, scenario] of [
    ['actual Expo manifest signing certificate and CSR APIs retain valid and rejected behavior', 'signing'],
    ['patched Forge rejects the upstream nested DigestAlgorithm forgery with real padding checks', 'nested-digest'],
    ['Forge rejects X.509 names outside a constrained CA while preserving permitted chains', 'name-constraints'],
  ]) {
    test(name, () => {
      const child = spawnSync(process.execPath, [
        '--max-old-space-size=192', fileURLToPath(import.meta.url), '--forge-compatibility-fixture', scenario,
      ], { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 });
      assert.ifError(child.error);
      assert.equal(child.signal, null, child.stderr);
      assert.equal(child.status, 0, child.stderr || child.stdout);
    });
  }
}

function checkSigning() {
  const { cli, signing } = consumers();
  const certificates = signing('./build/main.js');
  const forge = signing('node-forge');
  // Ephemeral synthetic keys stay in memory; no developer signing material is read.
  const keyPair = certificates.generateKeyPair();
  const pem = certificates.convertKeyPairToPEM(keyPair);
  const restored = certificates.convertKeyPairPEMToKeyPair(pem);
  const certificate = certificates.generateSelfSignedCodeSigningCertificate({
    keyPair: restored,
    validityNotBefore: new Date(Date.now() - 60_000),
    validityNotAfter: new Date(Date.now() + 3_600_000),
    commonName: 'Pachi synthetic TEST signing certificate',
  });
  const certificatePEM = certificates.convertCertificateToCertificatePEM(certificate);
  const parsed = certificates.convertCertificatePEMToCertificate(certificatePEM);
  certificates.validateSelfSignedCertificate(parsed, restored);
  assert.equal(parsed.subject.getField('CN').value, 'Pachi synthetic TEST signing certificate');
  assert.equal(parsed.getExtension('keyUsage').digitalSignature, true);
  assert.equal(parsed.getExtension('extKeyUsage').codeSigning, true);
  assert.equal(parsed.verify(parsed), true);

  const csr = certificates.generateCSR(restored, 'Pachi synthetic TEST CSR');
  const parsedCSR = certificates.convertCSRPEMToCSR(certificates.convertCSRToCSRPEM(csr));
  assert.equal(parsedCSR.verify(), true);
  assert.equal(parsedCSR.subject.getField('CN').value, 'Pachi synthetic TEST CSR');
  assert.throws(() => certificates.convertCertificatePEMToCertificate('not a synthetic certificate'));

  const message = Buffer.from('{"inventory":"SYNTHETIC TEST ONLY","revision":1}', 'utf8');
  const signature = certificates.signBufferRSASHA256AndVerify(restored.privateKey, parsed, message);
  const { signManifestString } = cli('./build/src/utils/codesigning.js');
  assert.equal(signManifestString(message.toString('utf8'), {
    privateKey: pem.privateKeyPEM,
    certificateForPrivateKey: certificatePEM,
  }), signature);
  const signatureBytes = Buffer.from(signature, 'base64');
  assert.equal(verify('RSA-SHA256', message, pem.publicKeyPEM, signatureBytes), true);
  assert.equal(verify('RSA-SHA256', Buffer.from('changed synthetic manifest'), pem.publicKeyPEM, signatureBytes), false);
  const alteredSignature = Buffer.from(signatureBytes);
  alteredSignature[alteredSignature.length - 1] ^= 1;
  assert.equal(verify('RSA-SHA256', message, pem.publicKeyPEM, alteredSignature), false);
  assert.equal(parsed.publicKey.verify(forge.md.sha256.create().update(message.toString('binary')).digest().getBytes(), signatureBytes.toString('binary')), true);

  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherPrivatePEM = other.privateKey.export({ type: 'pkcs1', format: 'pem' });
  const otherPublicPEM = other.publicKey.export({ type: 'spki', format: 'pem' });
  const otherPair = certificates.convertKeyPairPEMToKeyPair({ privateKeyPEM: otherPrivatePEM, publicKeyPEM: otherPublicPEM });
  assert.throws(() => certificates.validateSelfSignedCertificate(parsed, otherPair), /does not match key pair public key/);
  assert.throws(() => signManifestString(message.toString('utf8'), {
    privateKey: otherPrivatePEM, certificateForPrivateKey: certificatePEM,
  }), /Signature generated with private key not valid|Encryption block is invalid/);
  const expired = certificates.generateSelfSignedCodeSigningCertificate({
    keyPair: restored,
    validityNotBefore: new Date(Date.now() - 3_600_000),
    validityNotAfter: new Date(Date.now() - 60_000),
    commonName: 'Pachi synthetic TEST expired certificate',
  });
  assert.throws(() => certificates.validateSelfSignedCertificate(expired, restored), /Certificate validity expired/);
}

function checkNestedDigest() {
  const { signing } = consumers();
  const forge = signing('node-forge');
  // Public e=3 vector from the authentic upstream v1.4.3 regression; no key secret.
  // https://github.com/digitalbazaar/forge/blob/v1.4.3/tests/unit/rsa.js
  // CVE-2026-85393 / GHSA-2g46-22mc-6gwp (older database ID GHSA-86w9-cpqp-85rv).
  const modulus =
    'E932AC92252F585B3A80A4DD76A897C8B7652952FE788F6EC8DD640587A1EE56' +
    '47670A8AD4C2BE0F9FA6E49C605ADF77B5174230AF7BD50E5D6D6D6D28CCF0A8' +
    '86A514CC72E51D209CC772A52EF419F6A953F3135929588EBE9B351FCA61CED7' +
    '8F346FE00DBB6306E5C2A4C6DFC3779AF85AB417371CF34D8387B9B30AE46D7A' +
    '5FF5A655B8D8455F1B94AE736989D60A6F2FD5CADBFFBD504C5A756A2E6BB5CE' +
    'CC13BCA7503F6DF8B52ACE5C410997E98809DB4DC30D943DE4E812A47553DCE5' +
    '4844A78E36401D13F77DC650619FED88D8B3926E3D8E319C80C744779AC5D6AB' +
    'E252896950917476ECE5E8FC27D5F053D6018D91B502C4787558A002B9283DA7';
  const signatureHex =
    '00000000000000000000000000000000000000000000000000000000000000' +
    '00000000000000000000000000000000000000000000000000000000000000' +
    '00000000000000000000000000000000000000000000000000000000000000' +
    '00000000000000000000000000000000000000000000000000000000000000' +
    '00000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000032cbfd4a7adc7905583d7920d7165d' +
    '77cf8d6f4b19a4c14026dc9bf5576b2de2aab4a0dc9d8303ba8e365764f52a' +
    '49da7a2dfc5bed616f52d37d860cb283543d93fe1b73ca6379278422fd8821' +
    'eeeddc3a1bee99f9';
  const publicKey = forge.pki.rsa.setPublicKey(new forge.jsbn.BigInteger(modulus, 16), new forge.jsbn.BigInteger('3'));
  const digest = forge.md.sha256.create().update('hello world!').digest().getBytes();
  const signature = forge.util.hexToBytes(signatureHex);
  assert.equal(signature.length, 256);
  // No _skipPaddingChecks or parser bypass: this is the public verify API.
  assert.throws(() => publicKey.verify(digest, signature), /ASN\.1 object does not contain a valid RSASSA-PKCS1-v1_5 DigestInfo value/);
}

function checkNameConstraints() {
  // Adapted from upstream v1.4.3 tests/pocs/ghsa-3cc4-3294-vgjf.js.
  // All keys/certificates are synthetic and remain in the bounded child memory.
  const forge = consumers().signing('node-forge');
  const { pki, asn1 } = forge;
  const keys = Array.from({ length: 3 }, () => pki.rsa.generateKeyPair(2048));
  function certificate(subject, issuer, key, signingKey, serial, extensions) {
    const cert = pki.createCertificate();
    cert.publicKey = key.publicKey;
    cert.serialNumber = serial;
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter = new Date(Date.now() + 3_600_000);
    cert.setSubject([{ name: 'commonName', value: subject }]);
    cert.setIssuer([{ name: 'commonName', value: issuer }]);
    cert.setExtensions(extensions);
    cert.sign(signingKey.privateKey, forge.md.sha256.create());
    return pki.certificateFromPem(pki.certificateToPem(cert), true);
  }
  const caExtensions = [
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true },
  ];
  const root = certificate('Synthetic root', 'Synthetic root', keys[0], keys[0], '01', caExtensions);
  const store = pki.createCaStore([root]);
  const constraint = asn1.toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, false, '.example.test'),
      ]),
    ]),
  ])).getBytes();
  for (const critical of [false, true]) {
    const intermediate = certificate('Synthetic intermediate', 'Synthetic root', keys[1], keys[0], '02', [
      ...caExtensions, { id: '2.5.29.30', critical, value: constraint },
    ]);
    for (const useSAN of [false, true]) {
      for (const [name, allowed] of [['home.example.test', true], ['outside.test', false]]) {
        const leaf = certificate(name, 'Synthetic intermediate', keys[2], keys[1], '03',
          useSAN ? [{ name: 'subjectAltName', altNames: [{ type: 2, value: name }] }] : []);
        if (allowed) assert.equal(pki.verifyCertificateChain(store, [leaf, intermediate]), true);
        else assert.throws(() => pki.verifyCertificateChain(store, [leaf, intermediate]),
          error => error.error === 'forge.pki.BadCertificate' && /name constraint/i.test(error.message));
      }
    }
  }
}
