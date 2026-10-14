export interface RiderData {
  riderId: string;
  helmet: boolean;
  alcohol: boolean;
  alcoholValue: number;
  buzzer: boolean;
  banned: boolean;
  helmetMissingSeconds: number;
  banRemainingSeconds: number;
  updatedAt: number;
}

export type ConnectionStatus = 
  | 'connecting'
  | 'connected'
  | 'waiting_for_device'
  | 'disconnected'
  | 'error';
