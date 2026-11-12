/** 時鐘（測試替身注入點）。「今天」一律由 now() 以 Asia/Taipei 換算。 */
export interface Clock {
  now(): Date;
}
