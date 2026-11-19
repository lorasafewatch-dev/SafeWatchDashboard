export const incidentTime = value => Number.isFinite(Date.parse(value)) ? `${new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} PHT` : 'Time unavailable';
