// Phone view of the ticket (on wide screens the ticket is always visible next to the menu).
import { navigate } from '../lib/store';
import Ticket from './Ticket';

export default function Cart() {
  return (
    <div className="screen">
      <Ticket onBack={() => navigate('order')} />
    </div>
  );
}
