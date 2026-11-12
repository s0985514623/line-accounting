import { bootstrap } from './bootstrap';

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 掛載點');

void bootstrap(container);
