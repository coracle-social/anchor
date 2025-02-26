"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const supertest_1 = __importDefault(require("supertest"));
const server_js_1 = require("../src/server.js");
const database_js_1 = require("../src/database.js");
(0, node_test_1.describe)('Server', () => {
    (0, node_test_1.beforeEach)(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, database_js_1.migrate)();
        yield (0, database_js_1.run)("DELETE FROM emails WHERE email = ?", ['test@example.com']);
    }));
    (0, node_test_1.describe)('GET /', () => {
        (0, node_test_1.it)('returns NIP-11 info', () => __awaiter(void 0, void 0, void 0, function* () {
            const response = yield (0, supertest_1.default)(server_js_1.server)
                .get('/')
                .expect('Content-Type', 'application/nostr+json; charset=utf-8')
                .expect(200);
            strict_1.default.equal(response.body.name, 'Anchor');
            strict_1.default.equal(response.body.description, 'A relay/notifier combo for email notifications');
            strict_1.default.ok(response.body.pubkey);
        }));
    });
    (0, node_test_1.describe)('GET /unsubscribe', () => {
        (0, node_test_1.it)('returns unsubscribe page', () => __awaiter(void 0, void 0, void 0, function* () {
            const response = yield (0, supertest_1.default)(server_js_1.server)
                .get('/unsubscribe?email=test@example.com&token=abc123')
                .expect('Content-Type', /html/)
                .expect(200);
            strict_1.default.match(response.text, /Unsubscribing from Notifications/);
            strict_1.default.match(response.text, /test@example.com/);
            strict_1.default.match(response.text, /abc123/);
        }));
    });
    (0, node_test_1.describe)('POST /email/confirm', () => {
        (0, node_test_1.it)('confirms valid email token', () => __awaiter(void 0, void 0, void 0, function* () {
            const email = 'test@example.com';
            const token = yield (0, database_js_1.addEmail)({ email });
            const response = yield (0, supertest_1.default)(server_js_1.server)
                .post('/email/confirm')
                .send({ email, token })
                .expect(200);
            strict_1.default.equal(response.body.ok, true);
        }));
        (0, node_test_1.it)('rejects invalid token', () => __awaiter(void 0, void 0, void 0, function* () {
            const response = yield (0, supertest_1.default)(server_js_1.server)
                .post('/email/confirm')
                .send({
                email: 'test@example.com',
                token: 'invalid'
            })
                .expect(400);
            strict_1.default.equal(response.body.error, 'It looks like that confirmation code is invalid or has expired.');
        }));
    });
    (0, node_test_1.describe)('POST /email/unsubscribe', () => {
        (0, node_test_1.it)('removes email with valid token', () => __awaiter(void 0, void 0, void 0, function* () {
            const email = 'test@example.com';
            const token = yield (0, database_js_1.addEmail)({ email });
            const { token } = yield (0, database_js_1.get)('SELECT token FROM emails WHERE email = ?', [email]);
            const response = yield (0, supertest_1.default)(server_js_1.server)
                .post('/email/unsubscribe')
                .send({ email, token })
                .expect(200);
            strict_1.default.equal(response.body.ok, true);
        }));
        (0, node_test_1.it)('rejects invalid token', () => __awaiter(void 0, void 0, void 0, function* () {
            const response = yield (0, supertest_1.default)(server_js_1.server)
                .post('/email/unsubscribe')
                .send({
                email: 'test@example.com',
                token: 'invalid'
            })
                .expect(401);
            strict_1.default.equal(response.body.error, 'Invalid access token');
        }));
    });
});
