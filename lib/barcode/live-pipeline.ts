/** Shared busy flag so live YOLO locate yields while decode worker runs. */

let decodeBusy = false;

export function setLiveDecodeBusy(busy: boolean): void {
  decodeBusy = busy;
}

export function isLiveDecodeBusy(): boolean {
  return decodeBusy;
}
