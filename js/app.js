var TRANSPOSE = 36;
var timeout;
var ACTIVITY_MS = 3000;
// var synth = T("OscGen", {wave:"sin", mul:0.25}).play();

// var wad_1_soft_sine = new Wad({
// 	source : 'sine',
// 	volume: 0.42,
// 	env: {
// 		attack: 0.01,
// 		decay: 0.1,
// 		sustain: 0.4,
// 		hold: 32,
// 		release: 0.15
// 	},
// 	filter: {
// 		type: 'lowpass',
// 		frequency: 6,
// 		q: 0.7,
// 		env: {
// 			frequency: 2000,
// 			attack: 3
// 		}
// 	}
// });

// var wad_2_hard_sine = new Wad({
// 	source : 'sine',
// 	volume: 0.66,
// 	env: {
// 		attack: 0.005,
// 		decay: 0.2,
// 		sustain: 0,
// 		hold: 0,
// 		release: 0.05
// 	}
// });

// var synth = new Wad.Poly();

// synth.add(wad_2_hard_sine).add(wad_1_soft_sine);

var MAP = {

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

// Find mapping by keycode
var mapping_by_kcode = function(c) {
	var f = function(k) {
		if (k.code == c) { return true;	}
	}

	var m = _.find(MAP, f);

	return m;
}

// Find mapping by note_num
var mapping_by_notenum = function(num) {
	var f = function(k) {
		if (k.note_num == num) { return true }
	}
	var m = _.find(MAP, f)
	return m
}

// Find frequency for MIDI note
var note_to_freq = function(midi) {
	return 440 * Math.pow(2, (midi - 69) / 12);
}

// Find fequency for mapping
var freq_for_mapping = function(m) {

	var note = TRANSPOSE + m.x * 4 + m.y *3;

	var freq = note_to_freq(note);

	return freq;
}

// Find note for keyboard key
var note_for_key = function(e) {
	var find_mapping = function(key) {
		if (key.code == e.keyCode) {return true}
	}

	var current_key = _.find(MAP, find_mapping);

	if (current_key == undefined) {
		return e.preventDefault()
	};

	var the_x = current_key.x * 4;
	var the_y = current_key.y * 3;

	var note = TRANSPOSE + the_x + the_y;

	return note;

};

// Find frequency for keyboard key
var freq_for_key = function(e) {
	
	var note = note_for_key(e);

	var freq = note_to_freq(note);

	return freq;

};

// Decorate mappings
// - add the key frequency
// - add the note number
// - add the key color_class
_.each(MAP, function(key) {
	key.freq = freq_for_mapping(key);

	key.note_num = 4 * key.x + 3 * key.y + TRANSPOSE;

	if (key.black == true) {
		key.color_class = 'black_key raised_key';
	} else {
		key.color_class = 'white_key';
	}
})

// Adds or removes key_active class from keys in DOM
var toggle_key = function(k, on_off) {
	if (on_off == true) {
		var add_or_remove = "addClass";
		var inverse = 'removeClass';
	} else {
		var add_or_remove = "removeClass";
		var inverse = 'addClass';
	};

	var selector = '.key_' + k.note_num + ', .key_' + k.x + '_' + k.y;
	var $key = $(selector);

	$key[add_or_remove]('key_active');
	$key[inverse]('key_inactive');
}

function playNote(pitch, label) {
	// synth.noteOnWithFreq(freq, 100);

	// synth.play({
	// 	pitch: pitch,
	// 	label: label
	// })

	output.playNote(pitch)
}

function stopNote(label) {
	// synth.noteOff(note, 100);

	// synth.stop(label);
	output.stopNote(label)
}

var keyOnDOM = function(k) {
	if (k == undefined) { return false }
	if (k.timeout != undefined) { clearTimeout(k.timeout) }
			
	toggle_key(k, true)
}

var keyOffDOM = function(k) {
	if (k.timeout != undefined) { clearTimeout(k.timeout) }

	k.timeout = setTimeout(function(){
		var s = '.key_' + k.x + '_' + k.y
		$(s).removeClass('key_inactive')
	}, ACTIVITY_MS)

	toggle_key(k, false)
}


// Handle key pressed
// - Start sound
// - Style the key
$(document).on('keydown', function(e){
	var freq = freq_for_key(e)
	var k = mapping_by_kcode(e.keyCode)
	
	if (k == undefined) { return false }

	if (k.pressed != true) {
		k.pressed = true
		playNote(k.note_num)
		keyOnDOM(k)
	}
})


// Handle key release
// - Stop sounds
// - Remove the active className from key in DOM
// - Remove the fadeout behavior after 5s
$(document).on('keyup', function(e){
	var note = note_for_key(e);
	var k = mapping_by_kcode(e.keyCode);

	if (k == undefined) { return false }

	if (k.pressed != false) {
		k.pressed = false
		stopNote(k.note_num)
		keyOffDOM(k)
	}
})

// Find mapping object at x, y
var mapping_at = function(x, y) {
	var m = _.find(MAP, function(item) {
		return (item.x == x && item.y == y);
	})
	
	return m;
}

// Find character at x, y mapping
var key_char_at = function(x, y) {
	return mapping_at(x, y).chr;
}

// draw keyboard
function drawKeyboard() {
	for (var y = 5; y >= 1; y--) {
		
		var $row = $('<div class="row row_' + y + '"></div>');

		$('.computer_keys').append($row);

		for (var x = 1; x <= 10; x++) {
			var the_x = x;
			var the_y = y;
			if (y == 5) {
				the_x++;
			};

			var m = _.find(MAP, function(i){return (i.x == the_x && i.y == the_y)});

			var keyClass = 'key_' + the_x + '_' + the_y + ' ';
			var colorClass = m.color_class;

			var $key = $('<span class="key ' + keyClass + ' ' + colorClass + '">' +
							'<span class="kc">' + key_char_at(the_x, the_y) + '</span>' + 
							'<span class="hz">' + Math.round(freq_for_mapping(m)) + ' Hz</span>' + 
							'<span class="note">' + m.note + '</span>' + 
						 '</span>')

			$row.append($key)
		};
	}
}

// draw piano keys
function drawPianoKeys() {
	for (var k = 4 * 3 - 7; k <= 8 * 5 + 20; k++) {
		var note = k + TRANSPOSE;
		var m = _.find(MAP, function(m){
			return (m.note_num == note);
		})

		if (m != undefined) {
			var keyClass = 'key_' + m.x + '_' + m.y;
			var colorClass = m.color_class;
			var noteClass = 'key_' + m.note_num;

			var key_element = $('<span class="key ' + keyClass + ' ' + colorClass + ' ' + noteClass + '"></span>');
			$('.piano_keys').append(key_element);
		} else {
			var key_element = $('<span class="key key_' + note + '"></span>');
			$('.piano_keys').append(key_element);
		}
	}
}

var input, output = null;

function listenForNotes() {
	// Events arrive with a note property, that holds the name, octave and number
	// example: e.note = { name: 'A3', octave: 3, number: 666 }

	// Listen for a 'note on' message on all channels
	input.addListener('noteon', "all", function (e) {
		var k = mapping_by_notenum(e.note.number)
		keyOnDOM(k)
	})
	// Listemn for a 'note off' message on all channels
	input.addListener('noteoff', 'all', function (e) {
		var k = mapping_by_notenum(e.note.number)
		keyOffDOM(k)
	})
}

WebMidi.enable(function(err){
	// output = WebMidi.outputs[1]
	input = WebMidi.getInputByName('Qwerkey In')
	output = WebMidi.getOutputByName('Qwerkey Out')
	listenForNotes()
	console.log('this happens', input, output)
})

// var output = null;

// function onMIDIInit(midi) {
// 	midi.outputs.forEach(function(out) {
// 		output = out
// 	});

// 	output.open();
// 	debugger;
// };
// function onMIDISystemError() {
// 	console.log('error')
// };

// window.addEventListener('load', function() {   
//   navigator.requestMIDIAccess().then( 
//     onMIDIInit, 
//     onMIDISystemError );
// });

// Generate keyboard & piano
$(function() {
	drawKeyboard();
	drawPianoKeys();
})
