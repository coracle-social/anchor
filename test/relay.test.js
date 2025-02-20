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
const ws_1 = __importDefault(require("ws"));
const util_1 = require("@welshman/util");
const signer_1 = require("@welshman/signer");
const env_js_1 = require("../src/env.js");
const server_js_1 = require("../src/server.js");
const database_js_1 = require("../src/database.js");
const port = 18080;
const url = `ws://localhost:${port}`;
const signer = signer_1.Nip01Signer.ephemeral();
let wsServer;
(0, node_test_1.describe)('WebSocket Server', () => {
    (0, node_test_1.beforeEach)(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, database_js_1.migrate)();
        yield new Promise(resolve => {
            wsServer = server_js_1.server.listen(port, resolve);
        });
    }));
    (0, node_test_1.afterEach)(() => {
        wsServer.close();
    });
    const withWebSocket = (fn) => __awaiter(void 0, void 0, void 0, function* () {
        const ws = new ws_1.default(url);
        try {
            yield fn(ws);
        }
        finally {
            ws.close();
        }
    });
    const waitForMessage = (ws) => {
        return new Promise((resolve) => {
            ws.once('message', (data) => {
                resolve(JSON.parse(data.toString()));
            });
        });
    };
    const makeAuthEvent = (challenge) => signer.sign((0, util_1.createEvent)(22242, {
        tags: [
            ['relay', url],
            ['challenge', challenge]
        ]
    }));
    const makeSubscriptionEvent = () => __awaiter(void 0, void 0, void 0, function* () {
        const recipient = yield env_js_1.appSigner.getPubkey();
        const tags = [["d", "test"], ['p', recipient]];
        const content = yield signer.nip44.encrypt(recipient, JSON.stringify([['email', 'test@example.com']]));
        const event = yield signer.sign((0, util_1.createEvent)(32830, { tags, content }));
        return event;
    });
    const authenticate = (ws) => __awaiter(void 0, void 0, void 0, function* () {
        const [_, challenge] = yield waitForMessage(ws);
        const request = yield makeAuthEvent(challenge);
        ws.send(JSON.stringify(['AUTH', request]));
        const response = yield waitForMessage(ws);
        return { challenge, request, response };
    });
    (0, node_test_1.describe)('Authentication', () => {
        (0, node_test_1.it)('sends AUTH challenge on connect', () => __awaiter(void 0, void 0, void 0, function* () {
            yield withWebSocket((ws) => __awaiter(void 0, void 0, void 0, function* () {
                const message = yield waitForMessage(ws);
                strict_1.default.equal(message[0], 'AUTH');
                strict_1.default.ok(message[1], 'Challenge should be present');
            }));
        }));
        (0, node_test_1.it)('accepts valid auth event', () => __awaiter(void 0, void 0, void 0, function* () {
            yield withWebSocket((ws) => __awaiter(void 0, void 0, void 0, function* () {
                const { request, response } = yield authenticate(ws);
                strict_1.default.deepEqual(response, ['OK', request.id, true, '']);
            }));
        }));
        (0, node_test_1.it)('rejects invalid auth event', () => __awaiter(void 0, void 0, void 0, function* () {
            yield withWebSocket((ws) => __awaiter(void 0, void 0, void 0, function* () {
                yield waitForMessage(ws);
                const request = yield makeAuthEvent('wrong_challenge');
                ws.send(JSON.stringify(['AUTH', request]));
                const response = yield waitForMessage(ws);
                strict_1.default.equal(response[2], false);
                strict_1.default.ok(response[3].includes('invalid'));
            }));
        }));
    });
    (0, node_test_1.describe)('Event handling', () => {
        (0, node_test_1.it)('rejects non-subscription events', () => __awaiter(void 0, void 0, void 0, function* () {
            yield withWebSocket((ws) => __awaiter(void 0, void 0, void 0, function* () {
                yield waitForMessage(ws); // Skip AUTH challenge
                const event = yield signer.sign((0, util_1.createEvent)(1));
                ws.send(JSON.stringify(['EVENT', event]));
                const response = yield waitForMessage(ws);
                strict_1.default.equal(response[2], false);
                strict_1.default.ok(response[3].includes('Event kind not accepted'));
            }));
        }));
        (0, node_test_1.it)('accepts valid subscription event', () => __awaiter(void 0, void 0, void 0, function* () {
            yield withWebSocket((ws) => __awaiter(void 0, void 0, void 0, function* () {
                yield authenticate(ws);
                const event = yield makeSubscriptionEvent();
                ws.send(JSON.stringify(['EVENT', event]));
                const response = yield waitForMessage(ws);
                strict_1.default.deepEqual(response, ['OK', event.id, true, '']);
            }));
        }));
    });
});
