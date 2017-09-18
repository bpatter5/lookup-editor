

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

    def get_lookup(self, session_key, user, lookup_file, namespace="lookup_editor", owner=None, get_default_csv=True,
                   version=None, throw_exception_if_too_big=False):
        """
        Get a file handle to the associated lookup file.
        """

        self.logger.debug("Version is:" + str(version))

        # Check capabilities
        #LookupEditor.check_capabilities(lookup_file, user, session_key)

        # Get the file path
        file_path = self.resolve_lookup_filename(lookup_file, namespace, owner, get_default_csv,
                                                 version)

        if throw_exception_if_too_big:

            try:
                file_size = os.path.getsize(file_path)

                self.logger.info('Size of lookup file determined, file_size=%s, path=%s',
                                 file_size, file_path)

                if file_size > settings.MAXIMUM_EDITABLE_SIZE:
                    raise LookupFileTooBigException(file_size)

            except os.error:
                self.logger.exception("Exception generated when attempting to determine size of " +
                                      "requested lookup file")

        self.logger.info("Loading lookup file from path=%s", file_path)

        # Get the file handle
        # Note that we are assuming that the file is in UTF-8. Any characters that don't match
        # will be replaced.
        return codecs.open(file_path, 'rb', encoding='utf-8', errors='replace')
