import { SENIOR_AVATAR } from './avatar.js';

// Leaflet accepts an HTMLElement. Never feed a senior's name to an HTML sink.
export function createSeniorMarker({ trusted = false, live = true, inside = true, pointer = false } = {}) {
  const wrapper = document.createElement('div');
  const circle = document.createElement('div');
  const color = trusted ? '#3b82f6' : !live ? '#d97706' : inside ? '#10b981' : '#ef4444';
  wrapper.style.cssText = 'position:relative;width:48px;height:48px';
  circle.style.cssText = `width:48px;height:48px;box-sizing:border-box;border:4px solid ${color};border-radius:50%;background:white;box-shadow:0 4px 12px #0003;overflow:hidden`;
  const image = document.createElement('img');
  image.src = SENIOR_AVATAR;
  image.alt = '';
  image.style.cssText = 'width:100%;height:100%';
  circle.append(image);
  wrapper.append(circle);
  if (pointer) {
    const tip = document.createElement('span');
    tip.style.cssText = `position:absolute;bottom:-4px;left:18px;width:12px;height:12px;transform:rotate(45deg);background:${color};border-right:1px solid white;border-bottom:1px solid white`;
    wrapper.append(tip);
  }
  return wrapper;
}
