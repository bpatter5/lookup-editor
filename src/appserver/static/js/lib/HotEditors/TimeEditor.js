require.config({
    paths: {
		Handsontable: "../app/lookup_editor/js/lib/handsontable/handsontable",
		pikaday: "../app/lookup_editor/js/lib/pikaday/pikaday",
		numbro: "../app/lookup_editor/js/lib/numbro/numbro",
		moment: '../app/lookup_editor/js/lib/moment/moment',
        console: '../app/lookup_editor/js/lib/console',
        formatTime: '../app/lookup_editor/js/utils/formatTime',
		"bootstrap-tags-input": "../app/lookup_editor/js/lib/bootstrap-tagsinput.min"
    },
    shim: {
        'Handsontable': {
        	deps: ['jquery', 'pikaday', 'numbro', 'moment']
		},
    }
});

define([
    "Handsontable",
    "formatTime"
], function(
    Handsontable,
    formatTime
){
    TimeEditor = Handsontable.editors.TextEditor.prototype.extend();
        	
    TimeEditor.prototype.prepare = function(row, col, prop, td, originalValue, cellProperties){
        // Convert the seconds-since-epoch to a nice string.
        Handsontable.editors.TextEditor.prototype.prepare.apply(this, [row, col, prop, td, formatTime(originalValue), cellProperties]);
    };

    return TimeEditor;
});