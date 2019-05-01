require.config({
    paths: {
		Handsontable: "../app/lookup_editor/js/lib/handsontable/handsontable",
		pikaday: "../app/lookup_editor/js/lib/pikaday/pikaday",
		numbro: "../app/lookup_editor/js/lib/numbro/numbro",
		moment: '../app/lookup_editor/js/lib/moment/moment',
		console: '../app/lookup_editor/js/lib/console',
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
], function(
	Handsontable
){
    ForgivingCheckboxEditor = Handsontable.editors.CheckboxEditor.prototype.extend();

    ForgivingCheckboxEditor.prototype.prepare = function(row, col, prop, td, originalValue, cellProperties){
        		
        // If the value is invalid, then set it to false and allow the user to edit it
        if(originalValue !== true && originalValue !== false){
            console.warn("This cell is not a boolean value, it will be populated with 'false', cell=(" + row + ", " + col + ")");
            this.instance.setDataAtCell(row, col, false);
        }
        
        Handsontable.editors.CheckboxEditor.prototype.prepare.apply(this, arguments);
    };

    return ForgivingCheckboxEditor;
});