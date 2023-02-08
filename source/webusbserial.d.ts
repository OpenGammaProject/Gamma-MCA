type DataCallback = (data:Uint8Array)=>void;
type ErrorCallback = (data:any)=>void;

export class WebUSBSerialPort {
  constructor(device:any, portConfiguration:any);
  connect(onData:DataCallback, onError:ErrorCallback):void;
  send(data:string):void;
  disconnect():void;
}
