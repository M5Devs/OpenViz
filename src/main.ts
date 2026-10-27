import './index.css';
import { StudioController } from './ui/studio';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('studioCanvas') as HTMLCanvasElement;
  if (canvas) {
    new StudioController(canvas);
  }
});
