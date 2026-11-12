import { setupServer } from 'msw/node';
import { handlers, logRequest } from './handlers';

export const server = setupServer(...handlers);

server.events.on('request:start', ({ request }) => logRequest(request));
