/**
 * Get renderer that handles conversion to/from a list of tags.
 */
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
    ArrayEditor = Handsontable.editors.TextEditor.prototype.extend();

    ArrayEditor.prototype.createElements = function () {
        // Call the original createElements method
        Handsontable.editors.TextEditor.prototype.createElements.apply(this, arguments);

        $(this.TEXTAREA).attr("placeholder", "Enter values separated by commas; click outside the cell to persist the value");

        // Create the tags input widget
        $(this.TEXTAREA).tagsinput({
            confirmKeys: [44],
            allowDuplicates: true,
            tagClass: 'label label-info arrayValue'
        });
    };

    ArrayEditor.prototype.getValue = function () {
        var value = Handsontable.editors.TextEditor.prototype.getValue.apply(this, arguments);

        // Stop if we have no value
        if(value.length === 0) {
            return "";
        }

        return JSON.stringify($(this.TEXTAREA).tagsinput('items'));
    };

    ArrayEditor.prototype.setValue = function (new_value) {
        Handsontable.editors.TextEditor.prototype.setValue.apply(this, arguments);

        $(this.TEXTAREA).tagsinput('removeAll');
        try {
            values = JSON.parse(new_value);
            for(var c=0; c < values.length;c++){
                $(this.TEXTAREA).tagsinput('add', values[c]);
            }
            
        }
        catch(err) {
            // The value could not be parsed
        }
    };

    return ArrayEditor;
});