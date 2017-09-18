

import splunk

import os
import codecs
import json

from lookup_backups import LookupBackups
from exceptions import PermissionDeniedException, LookupFileTooBigException
from shortcuts import flatten_dict
import settings

class LookupEditor(LookupBackups):
    """
    This class provides functions for editing lookup files. It is bundled in an instantiable class
    so that it can be given a logger.

    This class inherits from LookupBackups in order to be able to leverage the .
    """

    def __init__(self, logger):
        super(LookupEditor, self).__init__()

    def get_kv_lookup(self, session_key, lookup_file, namespace="lookup_editor", owner=None):
        """
        Get the contents of a KV store lookup.
        """

        if owner is None:
            owner = 'nobody'

        lookup_contents = []

        # Get the fields so that we can compose the header
        # Note: this call must be done with the user context of "nobody".
        response, content = splunk.rest.simpleRequest('/servicesNS/nobody/' + namespace +
                                                      '/storage/collections/config/' +
                                                      lookup_file,
                                                      sessionKey=session_key,
                                                      getargs={'output_mode': 'json'})

        if response.status == 403:
            raise PermissionDeniedException("You do not have permission to view this lookup")

        header = json.loads(content)

        fields = ['_key']

        for field in header['entry'][0]['content']:
            if field.startswith('field.'):
                fields.append(field[6:])

        lookup_contents.append(fields)

        # Get the contents
        response, content = splunk.rest.simpleRequest('/servicesNS/' + owner + '/' + namespace +
                                                      '/storage/collections/data/' + lookup_file,
                                                      sessionKey=session_key,
                                                      getargs={'output_mode': 'json'})

        if response.status == 403:
            raise PermissionDeniedException("You do not have permission to view this lookup")

        rows = json.loads(content)

        for row in rows:
            new_row = []

            # Convert the JSON style format of the row and convert it down to chunk of text
            flattened_row = flatten_dict(row, fields=fields)

            # Add each field to the table row
            for field in fields:

                # If the field was found, add it
                if field in flattened_row:
                    new_row.append(flattened_row[field])

                # If the field wasn't found, add a blank string. We need to do this to make
                # sure that the number of columns is consistent. We can't have fewer data
                # columns than we do header columns. Otherwise, the header won't line up with
                # the field since the number of columns items in the header won't match the
                # number of columns in the rows.
                else:
                    new_row.append("")

            lookup_contents.append(new_row)

        return lookup_contents
