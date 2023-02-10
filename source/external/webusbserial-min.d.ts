/*
  Type definitions for the WebUSB FTDI Driver
*/

type DataCallback = (data: Uint8Array) => void;
type ErrorCallback = (data: any) => void;

export class WebUSBSerialPort {
  constructor(device: any, portConfiguration: any);
  connect(onData: DataCallback, onError: ErrorCallback): void;
  send(data: Uint8Array): void;
  disconnect(): void;
}
