interface KeyDefinition {
  code: number;
  x: number;
  y: number;
  chr: string;
  note: string;
  black: boolean;
}

export interface KeyMapping extends KeyDefinition {
  noteNumber: number;
  frequency: number;
  colorClass: string;
}

const definitions: Record<string, KeyDefinition> = {

	'1' : {code: 49, x: 1, y: 4, chr:  '1', note: 'E 2', black: false},
	'2' : {code: 50, x: 2, y: 4, chr:  '2', note: 'G#2', black: true },
	'3' : {code: 51, x: 3, y: 4, chr:  '3', note: 'C 3', black: false},
	'4' : {code: 52, x: 4, y: 4, chr:  '4', note: 'E 3', black: false},
	'5' : {code: 53, x: 5, y: 4, chr:  '5', note: 'G#3', black: true },
	'6' : {code: 54, x: 6, y: 4, chr:  '6', note: 'C 4', black: false},
	'7' : {code: 55, x: 7, y: 4, chr:  '7', note: 'E 4', black: false},
	'8' : {code: 56, x: 8, y: 4, chr:  '8', note: 'G#4', black: true },
	'9' : {code: 57, x: 9, y: 4, chr:  '9', note: 'C 5', black: false},
	'0' : {code: 48, x:10, y: 4, chr:  '0', note: 'E 5', black: false},

	'q' : {code: 81, x: 1, y: 3, chr:  'Q', note: 'C#2', black: true },
	'w' : {code: 87, x: 2, y: 3, chr:  'W', note: 'F 2', black: false},
	'e' : {code: 69, x: 3, y: 3, chr:  'E', note: 'A 2', black: false},
	'r' : {code: 82, x: 4, y: 3, chr:  'R', note: 'C#3', black: true },
	't' : {code: 84, x: 5, y: 3, chr:  'T', note: 'F 3', black: false},
	'y' : {code: 89, x: 6, y: 3, chr:  'Y', note: 'A 3', black: false},
	'u' : {code: 85, x: 7, y: 3, chr:  'U', note: 'C#4', black: true },
	'i' : {code: 73, x: 8, y: 3, chr:  'I', note: 'F 4', black: false},
	'o' : {code: 79, x: 9, y: 3, chr:  'O', note: 'A 4', black: false},
	'p' : {code: 80, x:10, y: 3, chr:  'P', note: 'C#5', black: true },

	'a' : {code: 65, x: 1, y: 2, chr:  'A', note: 'A#2', black: true },
	's' : {code: 83, x: 2, y: 2, chr:  'S', note: 'D 2', black: false},
	'd' : {code: 68, x: 3, y: 2, chr:  'D', note: 'F#2', black: true },
	'f' : {code: 70, x: 4, y: 2, chr:  'F', note: 'A#2', black: true },
	'g' : {code: 71, x: 5, y: 2, chr:  'G', note: 'D 3', black: false},
	'h' : {code: 72, x: 6, y: 2, chr:  'H', note: 'F#3', black: true },
	'j' : {code: 74, x: 7, y: 2, chr:  'J', note: 'A#3', black: true },
	'k' : {code: 75, x: 8, y: 2, chr:  'K', note: 'D 4', black: false},
	'l' : {code: 76, x: 9, y: 2, chr:  'L', note: 'F#4', black: true },
	';' : {code:186, x:10, y: 2, chr:  ';', note: 'A#4', black: true },

	'z' : {code: 90, x: 1, y: 1, chr:  'Z', note: 'G 2', black: false},
	'x' : {code: 88, x: 2, y: 1, chr:  'X', note: 'B 2', black: false},
	'c' : {code: 67, x: 3, y: 1, chr:  'C', note: 'D#2', black: true },
	'v' : {code: 86, x: 4, y: 1, chr:  'V', note: 'G 2', black: false},
	'b' : {code: 66, x: 5, y: 1, chr:  'B', note: 'B 2', black: false},
	'n' : {code: 78, x: 6, y: 1, chr:  'N', note: 'D#3', black: true },
	'm' : {code: 77, x: 7, y: 1, chr:  'M', note: 'G 3', black: false},
	',' : {code:188, x: 8, y: 1, chr:  ',', note: 'B 3', black: false},
	'.' : {code:190, x: 9, y: 1, chr:  '.', note: 'D#4', black: true },
	'/' : {code:191, x:10, y: 1, chr:  '/', note: 'G 4', black: false},

	'f1': {code:112, x: 2, y: 5, chr: 'F1', note: 'B 2', black: false},
	'f2': {code:113, x: 3, y: 5, chr: 'F2', note: 'D#3', black: true },
	'f3': {code:114, x: 4, y: 5, chr: 'F3', note: 'G 3', black: false},
	'f4': {code:115, x: 5, y: 5, chr: 'F4', note: 'B 3', black: false},
	'f5': {code:116, x: 6, y: 5, chr: 'F5', note: 'D#4', black: true },
	'f6': {code:117, x: 7, y: 5, chr: 'F6', note: 'G 4', black: false},
	'f7': {code:118, x: 8, y: 5, chr: 'F7', note: 'B 4', black: false},
	'f8': {code:119, x: 9, y: 5, chr: 'F8', note: 'D#5', black: true },
	'f9': {code:120, x:10, y: 5, chr: 'F9', note: 'G 5', black: false},
	'f10':{code:121, x:11, y: 5, chr:'F10', note: 'B 5', black: false}
	
};

export const mappings: readonly Readonly<KeyMapping>[] = Object.values(definitions).map(key => {
  const noteNumber = 36 + key.x * 4 + key.y * 3;
  return {
    ...key,
    noteNumber,
    frequency: 440 * Math.pow(2, (noteNumber - 69) / 12),
    colorClass: key.black ? 'black_key raised_key' : 'white_key',
  };
});
