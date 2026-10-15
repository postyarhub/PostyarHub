import { useEffect } from 'react';
import { notifyRouteChange } from '../../lib/routeEvents';

/** Campaign tools are mounted by wordpressTools into this stable route-owned host. */
export default function Campaigns() {
  useEffect(() => { notifyRouteChange(); }, []);
  return <section data-postyar-campaigns-host="1" aria-label="کمپین‌ها" style={{ display: 'grid', gap: 14, minWidth: 0 }} />;
}
