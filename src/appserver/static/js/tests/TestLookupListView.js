
require.config({
    paths: {
        lookup_list: "../app/lookup_editor/js/views/LookupListView"
    }
});

define([
    'lookup_list',
], function(
    LookupListView
) {
    describe('Lookup List:', () => {
        
        it('should render content', done => {
            var dom = $('<div><div id="base"></div></div>');

            var lookupListView = new LookupListView({
                el: $('#base', dom)
            });

            lookupListView.render();

            setTimeout(function(){
                if(lookupListView.$el.find('table').length > 0){
                    expect(lookupListView.$el.find('table').length).toBeGreaterThan(0);
                    done();
                }
            }.bind(this), 3000);
            
        });
    });
});